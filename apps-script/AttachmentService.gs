/**
 * AttachmentService.gs — evidence files (slips, receipts) in a private Drive
 * folder, linked to transactions through the TransactionAttachments tab.
 *
 * The image itself never enters the spreadsheet, links are never made public,
 * and an upload is idempotent per LINE message ID so a retry cannot create a
 * second copy.
 */

var ATTACHMENT_ALLOWED_MIME = ['image/jpeg', 'image/png'];
var ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

function idAttachment() { return idNew('S', function (id) { return !!repoFindOne('Attachments', 'attachment_id', id); }); }

function attachmentByMessageId(messageId) {
  return repoFindOne('Attachments', 'line_message_id', messageId);
}

function attachmentById(attachmentId) {
  return repoFindOne('Attachments', 'attachment_id', attachmentId);
}

function attachmentFolder_() {
  var id = getConfig('ATTACHMENT_FOLDER_ID', true);
  return DriveApp.getFolderById(id);
}

/**
 * Downloads the image from LINE and stores it once.
 * Returns {ok:true, attachment, duplicateOfMessage:boolean} or {ok:false, code}.
 */
function attachmentIngest(messageId, eventId, uploaderMemberId) {
  var existing = attachmentByMessageId(messageId);
  if (existing) return { ok: true, attachment: existing, duplicateOfMessage: true };

  var content = lineGetMessageContent(messageId);
  if (!content.ok) return { ok: false, code: content.code };
  if (ATTACHMENT_ALLOWED_MIME.indexOf(content.mime) < 0) return { ok: false, code: 'UNSUPPORTED_TYPE', mime: content.mime };
  if (content.size > ATTACHMENT_MAX_BYTES) return { ok: false, code: 'TOO_LARGE' };

  var bytes = content.blob.getBytes();
  var hash = authHexFromBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));

  var sameHash = repoFilter('Attachments', function (a) { return a.content_hash === hash; });
  var file;
  if (sameHash.length) {
    file = { getId: function () { return sameHash[0].drive_file_id; }, getUrl: function () { return sameHash[0].drive_url; } };
  } else {
    var ext = content.mime === 'image/png' ? '.png' : '.jpg';
    var named = Utilities.newBlob(bytes, content.mime, 'slip-' + timeTodayISO() + '-' + messageId.slice(-8) + ext);
    file = attachmentFolder_().createFile(named);
  }

  var row = {
    attachment_id: idAttachment(),
    line_message_id: messageId,
    event_id: eventId || '',
    uploader_member_id: uploaderMemberId || '',
    drive_file_id: file.getId(),
    drive_url: file.getUrl ? file.getUrl() : '',
    mime_type: content.mime,
    content_hash: hash,
    document_type: '',
    ocr_status: 'pending',
    extracted_json: '',
    created_at: timeNowISO(),
    expires_at: timePlusSecondsISO(30 * 24 * 3600)
  };
  repoAppendRows('Attachments', [row]);
  return { ok: true, attachment: row, duplicateOfMessage: false, sameContent: sameHash.length > 0 };
}

function attachmentSetOcr(attachmentId, status, documentType, extracted) {
  repoUpdateWhere('Attachments', 'attachment_id', attachmentId, {
    ocr_status: status,
    document_type: documentType || '',
    extracted_json: extracted ? JSON.stringify(extracted) : ''
  });
}

function attachmentExtracted(attachmentId) {
  var a = attachmentById(attachmentId);
  if (!a || !a.extracted_json) return null;
  try { return JSON.parse(a.extracted_json); } catch (e) { return null; }
}

/** Links evidence to a transaction. Idempotent, and never copies an amount. */
function attachmentLink(transactionId, attachmentId, actorMemberId) {
  return repoWithLock(function () {
    var dup = repoFilter('TransactionAttachments', function (r) {
      return r.transaction_id === transactionId && r.attachment_id === attachmentId;
    });
    if (dup.length) return { ok: true, code: 'ALREADY_LINKED' };
    if (!txById(transactionId)) return { ok: false, code: 'NO_TRANSACTION' };
    if (!attachmentById(attachmentId)) return { ok: false, code: 'NO_ATTACHMENT' };
    repoAppendRows('TransactionAttachments', [{
      transaction_id: transactionId, attachment_id: attachmentId,
      linked_by: actorMemberId || '', linked_at: timeNowISO()
    }]);
    // A linked file must survive the orphan TTL.
    repoUpdateWhere('Attachments', 'attachment_id', attachmentId, { expires_at: '' });
    auditLog('', transactionId, actorMemberId, 'attach_evidence', null, { attachment_id: attachmentId });
    return { ok: true, code: 'LINKED' };
  });
}

function attachmentsForTransaction(transactionId) {
  var links = repoFilter('TransactionAttachments', function (r) { return r.transaction_id === transactionId; });
  return links.map(function (l) { return attachmentById(l.attachment_id); }).filter(Boolean);
}

function attachmentIsLinked(attachmentId) {
  return repoFilter('TransactionAttachments', function (r) { return r.attachment_id === attachmentId; }).length > 0;
}

/**
 * Deletes uploads that were never confirmed and are past their TTL.
 * A file referenced by any transaction is never touched.
 */
function attachmentPruneOrphans() {
  var rows = repoFilter('Attachments', function (a) {
    return a.expires_at && timeIsPastISO(a.expires_at) && !attachmentIsLinked(a.attachment_id);
  });
  var removed = 0;
  rows.forEach(function (a) {
    try {
      var stillUsedElsewhere = repoFilter('Attachments', function (o) {
        return o.content_hash === a.content_hash && o.attachment_id !== a.attachment_id && attachmentIsLinked(o.attachment_id);
      }).length > 0;
      if (!stillUsedElsewhere && a.drive_file_id) DriveApp.getFileById(a.drive_file_id).setTrashed(true);
      repoDeleteRows('Attachments', [a._row]);
      removed++;
    } catch (e) {
      Logger.log('prune attachment failed ' + a.attachment_id + ': ' + configRedact(String(e)));
    }
  });
  return removed;
}
