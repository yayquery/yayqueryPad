/**
 * Copyright 2009 Google Inc.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import("comet");
import("ejs");
import("etherpad.collab.ace.easysync2.{AttribPool,Changeset}");
import("etherpad.log");
import("etherpad.pad.activepads");
import("etherpad.pad.model");
import("etherpad.pad.padutils");
import("etherpad.pad.padusers");
import("etherpad.pad.padevents");
import("etherpad.pad.pad_security");
import("etherpad.pro.pro_padmeta");
import("fastJSON");
import("fileutils.readFile");
import("jsutils.{eachProperty,keys}");
import("etherpad.collab.collabroom_server.*");
import("etherpad.collab.readonly_server");
jimport("java.util.concurrent.ConcurrentHashMap");

var PADPAGE_ROOMTYPE = "padpage";

function onStartup() {

}

function _padIdToRoom(padId) {
  return "padpage/"+padId;
}

function _roomToPadId(roomName) {
  return roomName.substring(roomName.indexOf("/")+1);
}

function removeFromMemory(pad) {
  // notification so we can free stuff
  if (getNumConnections(pad) == 0) {
    var tempObj = pad.tempObj();
    tempObj.revisionSockets = {};
  }
}

function _getPadConnections(pad) {
  return getRoomConnections(_padIdToRoom(pad.getId()));
}

function guestKnock(globalPadId, guestId, displayName) {
  var askedSomeone = false;

  // requires that we somehow have permission on this pad
  model.accessPadGlobal(globalPadId, function(pad) {
    var connections = _getPadConnections(pad);
    connections.forEach(function(connection) {
      // only send to pro users
      if (! padusers.isGuest(connection.data.userInfo.userId)) {
        askedSomeone = true;
        var msg = { type: "SERVER_MESSAGE",
                    payload: { type: 'GUEST_PROMPT',
                               userId: guestId,
                               displayName: displayName } };
        sendMessage(connection.connectionId, msg);
      }
    });
  });

  if (! askedSomeone) {
    pad_security.answerKnock(guestId, globalPadId, "denied");
  }
}

function _verifyUserId(userId) {
  var result;
  if (padusers.isGuest(userId)) {
    // allow cookie-verified guest even if user has signed in
    result = (userId == padusers.getGuestUserId());
  }
  else {
    result = (userId == padusers.getUserId());
  }
  return result;
}

function _checkChangesetAndPool(cs, pool) {
  Changeset.checkRep(cs);
  Changeset.eachAttribNumber(cs, function(n) {
    if (! pool.getAttrib(n)) {
      throw new Error("Attribute pool is missing attribute "+n+" for changeset "+cs);
    }
  });
}

function _doWarn(str) {
  log.warn(appjet.executionId+": "+str);
}

function _doInfo(str) {
  log.info(appjet.executionId+": "+str);
}

function _getPadRevisionSockets(pad) {
  var revisionSockets = pad.tempObj().revisionSockets;
  if (! revisionSockets) {
    revisionSockets = {}; // rev# -> socket id
    pad.tempObj().revisionSockets = revisionSockets;
  }
  return revisionSockets;
}

function applyUserChanges(pad, baseRev, changeset, optSocketId, optAuthor) {
  // changeset must be already adapted to the server's apool

  var apool = pad.pool();
  var r = baseRev;
  while (r < pad.getHeadRevisionNumber()) {
    r++;
    var c = pad.getRevisionChangeset(r);
    changeset = Changeset.follow(c, changeset, false, apool);
  }

  var prevText = pad.text();
  if (Changeset.oldLen(changeset) != prevText.length) {
    _doWarn("Can't apply USER_CHANGES "+changeset+" to document of length "+
            prevText.length);
    return;
  }

  var thisAuthor = '';
  if (optSocketId) {
    var connectionId = getSocketConnectionId(optSocketId);
    if (connectionId) {
      var connection = getConnection(connectionId);
      if (connection) {
        thisAuthor = connection.data.userInfo.userId;
      }
    }
  }
  if (optAuthor) {
    thisAuthor = optAuthor;
  }

  pad.appendRevision(changeset, thisAuthor);
  var newRev = pad.getHeadRevisionNumber();
  if (optSocketId) {
    _getPadRevisionSockets(pad)[newRev] = optSocketId;
  }

  var correctionChangeset = _correctMarkersInPad(pad.atext(), pad.pool());
  if (correctionChangeset) {
    pad.appendRevision(correctionChangeset);
  }

  ///// make document end in blank line if it doesn't:
  if (pad.text().lastIndexOf("\n\n") != pad.text().length-2) {
    var nlChangeset = Changeset.makeSplice(
      pad.text(), pad.text().length-1, 0, "\n");
    pad.appendRevision(nlChangeset);
  }

  updatePadClients(pad);

  activepads.touch(pad.getId());
  padevents.onEditPad(pad, thisAuthor);
}

function updateClient(pad, connectionId) {
  var conn = getConnection(connectionId);
  if (! conn) {
    return;
  }
  var lastRev = conn.data.lastRev;
  var userId = conn.data.userInfo.userId;
  var socketId = conn.socketId;
  while (lastRev < pad.getHeadRevisionNumber()) {
    var r = ++lastRev;
    var author = pad.getRevisionAuthor(r);
    var revisionSockets = _getPadRevisionSockets(pad);
    if (revisionSockets[r] === socketId) {
      sendMessage(connectionId, {type:"ACCEPT_COMMIT", newRev:r});
    }
    else {
      var forWire = Changeset.prepareForWire(pad.getRevisionChangeset(r), pad.pool());
      var msg = {type:"NEW_CHANGES", newRev:r,
                 changeset: forWire.translated,
                 apool: forWire.pool,
                 author: author};
      sendMessage(connectionId, msg);
    }
  }
  conn.data.lastRev = pad.getHeadRevisionNumber();
  updateRoomConnectionData(connectionId, conn.data);
}

function updatePadClients(pad) {
  _getPadConnections(pad).forEach(function(connection) {
    updateClient(pad, connection.connectionId);
  });

  readonly_server.updatePadClients(pad);
}

function applyMissedChanges(pad, missedChanges) {
  var userInfo = missedChanges.userInfo;
  var baseRev = missedChanges.baseRev;
  var committedChangeset = missedChanges.committedChangeset; // may be falsy
  var furtherChangeset = missedChanges.furtherChangeset; // may be falsy
  var apool = pad.pool();

  if (! _verifyUserId(userInfo.userId)) {
    return;
  }

  if (committedChangeset) {
    var wireApool1 = (new AttribPool()).fromJsonable(missedChanges.committedChangesetAPool);
    _checkChangesetAndPool(committedChangeset, wireApool1);
    committedChangeset = pad.adoptChangesetAttribs(committedChangeset, wireApool1);
  }
  if (furtherChangeset) {
    var wireApool2 = (new AttribPool()).fromJsonable(missedChanges.furtherChangesetAPool);
    _checkChangesetAndPool(furtherChangeset, wireApool2);
    furtherChangeset = pad.adoptChangesetAttribs(furtherChangeset, wireApool2);
  }

  var commitWasMissed = !! committedChangeset;
  if (commitWasMissed) {
    var commitSocketId = missedChanges.committedChangesetSocketId;
    var revisionSockets = _getPadRevisionSockets(pad);
    // was the commit really missed, or did the client just not hear back?
    // look for later changeset by this socket
    var r = baseRev;
    while (r < pad.getHeadRevisionNumber()) {
      r++;
      var s = revisionSockets[r];
      if (! s) {
        // changes are too old, have to drop them.
        return;
      }
      if (s == commitSocketId) {
        commitWasMissed = false;
        break;
      }
    }
  }
  if (! commitWasMissed) {
    // commit already incorporated by the server
    committedChangeset = null;
  }

  var changeset;
  if (committedChangeset && furtherChangeset) {
    changeset = Changeset.compose(committedChangeset, furtherChangeset, apool);
  }
  else {
    changeset = (committedChangeset || furtherChangeset);
  }

  if (changeset) {
    var author = userInfo.userId;

    applyUserChanges(pad, baseRev, changeset, null, author);
  }
}

function getAllPadsWithConnections() {
  // returns array of global pad id strings
  return getAllRoomsOfType(PADPAGE_ROOMTYPE).map(_roomToPadId);
}

function broadcastServerMessage(msgObj) {
  var msg = {type: "SERVER_MESSAGE", payload: msgObj};
  getAllRoomsOfType(PADPAGE_ROOMTYPE).forEach(function(roomName) {
    getRoomConnections(roomName).forEach(function(connection) {
      sendMessage(connection.connectionId, msg);
    });
  });
}

function appendPadText(pad, txt) {
  txt = model.cleanText(txt);
  var oldFullText = pad.text();
  _applyChangesetToPad(pad, Changeset.makeSplice(oldFullText,
                                                 oldFullText.length-1, 0, txt));
}

function setPadText(pad, txt) {
  txt = model.cleanText(txt);
  var oldFullText = pad.text();
  // replace text except for the existing final (virtual) newline
  _applyChangesetToPad(pad, Changeset.makeSplice(oldFullText, 0,
                                                 oldFullText.length-1, txt));
}

function setPadAText(pad, atext) {
  var oldFullText = pad.text();
  var deletion = Changeset.makeSplice(oldFullText, 0, oldFullText.length-1, "");

  var assem = Changeset.smartOpAssembler();
  Changeset.appendATextToAssembler(atext, assem);
  var charBank = atext.text.slice(0, -1);
  var insertion = Changeset.checkRep(Changeset.pack(1, atext.text.length,
    assem.toString(), charBank));

  var cs = Changeset.compose(deletion, insertion, pad.pool());
  Changeset.checkRep(cs);

  _applyChangesetToPad(pad, cs);
}

function applyChangesetToPad(pad, changeset) {
  Changeset.checkRep(changeset);

  _applyChangesetToPad(pad, changeset);
}

function _applyChangesetToPad(pad, changeset) {
  pad.appendRevision(changeset);
  updatePadClients(pad);
}

function getHistoricalAuthorData(pad, author) {
  var authorData = pad.getAuthorData(author);
  if (authorData) {
    var data = {};
    if ((typeof authorData.colorId) == "number") {
      data.colorId = authorData.colorId;
    }
    if (authorData.name) {
      data.name = authorData.name;
    }
    else {
      var uname = padusers.getNameForUserId(author);
      if (uname) {
        data.name = uname;
      }
    }
    return data;
  }
  return null;
}

function buildHistoricalAuthorDataMapFromAText(pad, atext) {
  var map = {};
  pad.eachATextAuthor(atext, function(author, authorNum) {
    var data = getHistoricalAuthorData(pad, author);
    if (data) {
      map[author] = data;
    }
  });
  return map;
}

function buildHistoricalAuthorDataMapForPadHistory(pad) {
  var map = {};
  pad.pool().eachAttrib(function(key, value) {
    if (key == 'author') {
      var author = value;
      var data = getHistoricalAuthorData(pad, author);
      if (data) {
        map[author] = data;
      }
    }
  });
  return map;
}

function getATextForWire(pad, optRev) {
  var atext;
  if ((optRev && ! isNaN(Number(optRev))) || (typeof optRev) == "number") {
    atext = pad.getInternalRevisionAText(Number(optRev));
  }
  else {
    atext = pad.atext();
  }

  var historicalAuthorData = buildHistoricalAuthorDataMapFromAText(pad, atext);

  var attribsForWire = Changeset.prepareForWire(atext.attribs, pad.pool());
  var apool = attribsForWire.pool;
  // mutate atext (translate attribs for wire):
  atext.attribs = attribsForWire.translated;

  return {atext:atext, apool:apool.toJsonable(),
          historicalAuthorData:historicalAuthorData };
}

function getCollabClientVars(pad) {
  // construct object that is made available on the client
  // as collab_client_vars

  var forWire = getATextForWire(pad);

  return {
    initialAttributedText: forWire.atext,
    rev: pad.getHeadRevisionNumber(),
    padId: pad.getLocalId(),
    globalPadId: pad.getId(),
    historicalAuthorData: forWire.historicalAuthorData,
    apool: forWire.apool,
    clientIp: request.clientAddr,
    clientAgent: request.headers["User-Agent"]
  };
}

function getNumConnections(pad) {
  return _getPadConnections(pad).length;
}

function getConnectedUsers(pad) {
  var users = [];
  _getPadConnections(pad).forEach(function(connection) {
    users.push(connection.data.userInfo);
  });
  return users;
}


function bootAllUsersFromPad(pad, reason) {
  return bootUsersFromPad(pad, reason);
}

function bootUsersFromPad(pad, reason, userInfoFilter) {
  var connections = _getPadConnections(pad);
  var bootedUserInfos = [];
  connections.forEach(function(connection) {
    if ((! userInfoFilter) || userInfoFilter(connection.data.userInfo)) {
      bootedUserInfos.push(connection.data.userInfo);
      bootConnection(connection.connectionId);
    }
  });
  return bootedUserInfos;
}

function dumpStorageToString(pad) {
  var lines = [];
  var errors = [];
  var head = pad.getHeadRevisionNumber();
  try {
    for(var i=0;i<=head;i++) {
      lines.push("changeset "+i+" "+Changeset.toBaseTen(pad.getRevisionChangeset(i)));
    }
  }
  catch (e) {
    errors.push("!!!!! Error in changeset "+i+": "+e.message);
  }
  for(var i=0;i<=head;i++) {
    lines.push("author "+i+" "+pad.getRevisionAuthor(i));
  }
  for(var i=0;i<=head;i++) {
    lines.push("time "+i+" "+pad.getRevisionDate(i));
  }
  var revisionSockets = _getPadRevisionSockets(pad);
  for(var k in revisionSockets) lines.push("socket "+k+" "+revisionSockets[k]);
  return errors.concat(lines).join('\n');
}

function _getPadIdForSocket(socketId) {
  var connectionId = getSocketConnectionId(socketId);
  if (connectionId) {
    var connection = getConnection(connectionId);
    if (connection) {
      return _roomToPadId(connection.roomName);
    }
  }
  return null;
}

function _getUserIdForSocket(socketId) {
  var connectionId = getSocketConnectionId(socketId);
  if (connectionId) {
    var connection = getConnection(connectionId);
    if (connection) {
      return connection.data.userInfo.userId;
    }
  }
  return null;
}

function _serverDebug(msg) { /* nothing */ }

function _accessSocketPad(socketId, accessType, padFunc, dontRequirePad) {
  return _accessCollabPad(_getPadIdForSocket(socketId), accessType,
                          padFunc, dontRequirePad);
}

function _accessConnectionPad(connection, accessType, padFunc, dontRequirePad) {
  return _accessCollabPad(_roomToPadId(connection.roomName), accessType,
                          padFunc, dontRequirePad);
}

function _accessCollabPad(padId, accessType, padFunc, dontRequirePad) {
  if (! padId) {
    if (! dontRequirePad) {
      _doWarn("Collab operation \""+accessType+"\" aborted because socket "+socketId+" has no pad.");
    }
    return;
  }
  else {
    return _accessExistingPad(padId, accessType, function(pad) {
      return padFunc(pad);
    }, dontRequirePad);
  }
}

function _accessExistingPad(padId, accessType, padFunc, dontRequireExist) {
  return model.accessPadGlobal(padId, function(pad) {
    if (! pad.exists()) {
      if (! dontRequireExist) {
        _doWarn("Collab operation \""+accessType+"\" aborted because pad "+padId+" doesn't exist.");
      }
      return;
    }
    else {
      return padFunc(pad);
    }
  });
}

function _handlePadUserInfo(pad, userInfo) {
  var author = userInfo.userId;
  var colorId = Number(userInfo.colorId);
  var name = userInfo.name;

  if (! author) return;

  // update map from author to that author's last known color and name
  var data = {colorId: colorId};
  if (name) data.name = name;
  pad.setAuthorData(author, data);
  padusers.notifyUserData(data);
}

function _sendUserInfoMessage(connectionId, type, userInfo) {
  if (translateSpecialKey(userInfo.specialKey) != 'invisible') {
    sendMessage(connectionId, {type: type, userInfo: userInfo });
  }
}


function getRoomCallbacks(roomName) {
  var callbacks = {};
  callbacks.introduceUsers =
    function (joiningConnection, existingConnection) {
      // notify users of each other
      _sendUserInfoMessage(existingConnection.connectionId,
                          "USER_NEWINFO",
                          joiningConnection.data.userInfo);
      _sendUserInfoMessage(joiningConnection.connectionId,
                          "USER_NEWINFO",
                          existingConnection.data.userInfo);
    };
  callbacks.extroduceUsers =
    function (leavingConnection, existingConnection) {
      _sendUserInfoMessage(existingConnection.connectionId, "USER_LEAVE",
                          leavingConnection.data.userInfo);
    };
  callbacks.onAddConnection =
    function (data) {
      model.accessPadGlobal(_roomToPadId(roomName), function(pad) {
        _handlePadUserInfo(pad, data.userInfo);
        padevents.onUserJoin(pad, data.userInfo);
        readonly_server.updateUserInfo(pad, data.userInfo);
      });
    };
  callbacks.onRemoveConnection =
    function (data) {
      model.accessPadGlobal(_roomToPadId(roomName), function(pad) {
        padevents.onUserLeave(pad, data.userInfo);
      });
    };
  callbacks.handleConnect =
    function (data) {
      if (roomName.indexOf("padpage/") != 0) {
        return null;
      }
      if (! (data.userInfo && data.userInfo.userId &&
             _verifyUserId(data.userInfo.userId))) {
        return null;
      }
      return data.userInfo;
    };
  callbacks.clientReady =
    function(newConnection, data) {
      var padId = _roomToPadId(newConnection.roomName);

      if (data.stats) {
        log.custom("padclientstats", {padId:padId, stats:data.stats});
      }

      var lastRev = data.lastRev;
      var isReconnectOf = data.isReconnectOf;
      var isCommitPending = !! data.isCommitPending;
      var connectionId = newConnection.connectionId;

      newConnection.data.lastRev = lastRev;
      updateRoomConnectionData(connectionId, newConnection.data);

      if (padutils.isProPadId(padId)) {
        pro_padmeta.accessProPad(padId, function(propad) {
          // tell client about pad title
          sendMessage(connectionId, {type: "CLIENT_MESSAGE", payload: {
            type: "padtitle", title: propad.getDisplayTitle() } });
          sendMessage(connectionId, {type: "CLIENT_MESSAGE", payload: {
            type: "padpassword", password: propad.getPassword() } });
        });
      }

      _accessExistingPad(padId, "CLIENT_READY", function(pad) {
        sendMessage(connectionId, {type: "CLIENT_MESSAGE", payload: {
          type: "padoptions", options: pad.getPadOptionsObj() } });

        updateClient(pad, connectionId);

      });

      if (isCommitPending) {
        // tell client that if it hasn't received an ACCEPT_COMMIT by now, it isn't coming.
        sendMessage(connectionId, {type:"NO_COMMIT_PENDING"});
      }
    };
  callbacks.handleMessage = function(connection, msg) {
    _handleCometMessage(connection, msg);
  };
  return callbacks;
}

var _specialKeys = [['x375b', 'invisible']];

function translateSpecialKey(specialKey) {
  // code -> name
  for(var i=0;i<_specialKeys.length;i++) {
    if (_specialKeys[i][0] == specialKey) {
      return _specialKeys[i][1];
    }
  }
  return null;
}

function getSpecialKey(name) {
  // name -> code
  for(var i=0;i<_specialKeys.length;i++) {
    if (_specialKeys[i][1] == name) {
      return _specialKeys[i][0];
    }
  }
  return null;
}

function _updateDocumentConnectionUserInfo(pad, socketId, userInfo) {
  var connectionId = getSocketConnectionId(socketId);
  if (connectionId) {
    var updatingConnection = getConnection(connectionId);
    updatingConnection.data.userInfo = userInfo;
    updateRoomConnectionData(connectionId, updatingConnection.data);
    _getPadConnections(pad).forEach(function(connection) {
      if (connection.socketId != updatingConnection.socketId) {
        _sendUserInfoMessage(connection.connectionId,
                             "USER_NEWINFO", userInfo);
      }
    });

    _handlePadUserInfo(pad, userInfo);
    padevents.onUserInfoChange(pad, userInfo);
    readonly_server.updateUserInfo(pad, userInfo);
  }
}

function _handleCometMessage(connection, msg) {

  var socketUserId = connection.data.userInfo.userId;
  if (! (socketUserId && _verifyUserId(socketUserId))) {
    // user has signed out or cleared cookies, no longer auth'ed
    bootConnection(connection.connectionId, "unauth");
  }

  if (msg.type == "USER_CHANGES") {
    try {
      _accessConnectionPad(connection, "USER_CHANGES", function(pad) {
        var baseRev = msg.baseRev;
        var wireApool = (new AttribPool()).fromJsonable(msg.apool);
        var changeset = msg.changeset;
        if (changeset) {
          _checkChangesetAndPool(changeset, wireApool);
          changeset = pad.adoptChangesetAttribs(changeset, wireApool);
          applyUserChanges(pad, baseRev, changeset, connection.socketId);
        }
      });
    }
    catch (e if e.easysync) {
      _doWarn("Changeset error handling USER_CHANGES: "+e);
    }
  }
  else if (msg.type == "USERINFO_UPDATE") {
    _accessConnectionPad(connection, "USERINFO_UPDATE", function(pad) {
      var userInfo = msg.userInfo;
      // security check
      if (userInfo.userId == connection.data.userInfo.userId) {
        _updateDocumentConnectionUserInfo(pad,
                                          connection.socketId, userInfo);
      }
      else {
        // drop on the floor
      }
    });
  }
  else if (msg.type == "CLIENT_MESSAGE") {
    _accessConnectionPad(connection, "CLIENT_MESSAGE", function(pad) {
      var payload = msg.payload;
      if (payload.authId &&
          payload.authId != connection.data.userInfo.userId) {
        // authId, if present, must actually be the sender's userId;
        // here it wasn't
      }
      else {
        getRoomConnections(connection.roomName).forEach(
          function(conn) {
            if (conn.socketId != connection.socketId) {
              sendMessage(conn.connectionId,
                          {type: "CLIENT_MESSAGE", payload: payload});
            }
          });
        padevents.onClientMessage(pad, connection.data.userInfo,
                                  payload);
      }
    });
  }
}

function _correctMarkersInPad(atext, apool) {
  var text = atext.text;

  // collect char positions of line markers (e.g. bullets) in new atext
  // that aren't at the start of a line
  var badMarkers = [];
  var iter = Changeset.opIterator(atext.attribs);
  var offset = 0;
  while (iter.hasNext()) {
    var op = iter.next();
    var listValue = Changeset.opAttributeValue(op, 'list', apool);
    if (listValue) {
      for(var i=0;i<op.chars;i++) {
        if (offset > 0 && text.charAt(offset-1) != '\n') {
          badMarkers.push(offset);
        }
        offset++;
      }
    }
    else {
      offset += op.chars;
    }
  }

  if (badMarkers.length == 0) {
    return null;
  }

  // create changeset that removes these bad markers
  offset = 0;
  var builder = Changeset.builder(text.length);
  badMarkers.forEach(function(pos) {
    builder.keepText(text.substring(offset, pos));
    builder.remove(1);
    offset = pos+1;
  });
  return builder.toString();
}
