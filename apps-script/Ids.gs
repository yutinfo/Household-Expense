/** Ids.gs — stable, human-typeable identifiers. Never use row numbers as IDs. */

var ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L to avoid confusion

function idRandom_(len) {
  var out = '';
  for (var i = 0; i < len; i++) out += ID_ALPHABET.charAt(Math.floor(Math.random() * ID_ALPHABET.length));
  return out;
}

function idNew(prefix, existsFn) {
  for (var attempt = 0; attempt < 20; attempt++) {
    var id = prefix + idRandom_(attempt < 10 ? 5 : 7);
    if (!existsFn || !existsFn(id)) return id;
  }
  throw new Error('ID_EXHAUSTED:' + prefix);
}

function idTransaction() { return idNew('T', function (id) { return !!repoFindOne('Transactions', 'transaction_id', id); }); }
function idPending() { return idNew('P', function (id) { return !!repoFindOne('PendingActions', 'action_id', id); }); }
function idRule() { return idNew('R', function (id) { return !!repoFindOne('Rules', 'rule_id', id); }); }
function idAudit() { return 'A' + Date.now().toString(36).toUpperCase() + idRandom_(3); }
function idBatch() { return 'B' + Date.now().toString(36).toUpperCase() + idRandom_(3); }
