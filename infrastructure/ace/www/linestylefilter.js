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

// THIS FILE IS ALSO AN APPJET MODULE: etherpad.collab.ace.linestylefilter
// %APPJET%: import("etherpad.collab.ace.easysync2.Changeset");

// requires: easysync2.Changeset

var linestylefilter = {};

linestylefilter.ATTRIB_CLASSES = {
  'bold':'tag:b',
  'italic':'tag:i',
  'underline':'tag:u',
  'strikethrough':'tag:s'
};

linestylefilter.getAuthorClassName = function(author) {
  return "author-"+author.replace(/[^a-y0-9]/g, function(c) {
    if (c == ".") return "-";
    return 'z'+c.charCodeAt(0)+'z';
  });
};

// lineLength is without newline; aline includes newline,
// but may be falsy if lineLength == 0
linestylefilter.getLineStyleFilter = function(lineLength, aline,
                                              textAndClassFunc, apool) {

  if (lineLength == 0) return textAndClassFunc;

  var nextAfterAuthorColors = textAndClassFunc;

  var authorColorFunc = (function() {
    var lineEnd = lineLength;
    var curIndex = 0;
    var extraClasses;
    var leftInAuthor;

    function attribsToClasses(attribs) {
      var classes = '';
      Changeset.eachAttribNumber(attribs, function(n) {
	var key = apool.getAttribKey(n);
	if (key) {
	  var value = apool.getAttribValue(n);
	  if (value) {
	    if (key == 'author') {
	      classes += ' '+linestylefilter.getAuthorClassName(value);
	    }
            else if (key == 'list') {
              classes += ' list:'+value;
            }
	    else if (linestylefilter.ATTRIB_CLASSES[key]) {
	      classes += ' '+linestylefilter.ATTRIB_CLASSES[key];
	    }
	  }
	}
      });
      return classes.substring(1);
    }

    var attributionIter = Changeset.opIterator(aline);
    var nextOp, nextOpClasses;
    function goNextOp() {
      nextOp = attributionIter.next();
      nextOpClasses = (nextOp.opcode && attribsToClasses(nextOp.attribs));
    }
    goNextOp();
    function nextClasses() {
      if (curIndex < lineEnd) {
	extraClasses = nextOpClasses;
	leftInAuthor = nextOp.chars;
	goNextOp();
	while (nextOp.opcode && nextOpClasses == extraClasses) {
	  leftInAuthor += nextOp.chars;
	  goNextOp();
	}
      }
    }
    nextClasses();

    return function(txt, cls) {
      while (txt.length > 0) {
	if (leftInAuthor <= 0) {
	  // prevent infinite loop if something funny's going on
	  return nextAfterAuthorColors(txt, cls);
	}
	var spanSize = txt.length;
	if (spanSize > leftInAuthor) {
	  spanSize = leftInAuthor;
	}
	var curTxt = txt.substring(0, spanSize);
	txt = txt.substring(spanSize);
	nextAfterAuthorColors(curTxt, (cls&&cls+" ")+extraClasses);
	curIndex += spanSize;
	leftInAuthor -= spanSize;
	if (leftInAuthor == 0) {
	  nextClasses();
	}
      }
    };
  })();
  return authorColorFunc;
};

linestylefilter.getAtSignSplitterFilter = function(lineText,
                                                   textAndClassFunc) {
  var at = /@/g;
  at.lastIndex = 0;
  var splitPoints = null;
  var execResult;
  while ((execResult = at.exec(lineText))) {
    if (! splitPoints) {
      splitPoints = [];
    }
    splitPoints.push(execResult.index);
  }

  if (! splitPoints) return textAndClassFunc;

  return linestylefilter.textAndClassFuncSplitter(textAndClassFunc,
                                                  splitPoints);
};

linestylefilter.REGEX_WORDCHAR = /[\u0030-\u0039\u0041-\u005A\u0061-\u007A\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0100-\u1FFF\u3040-\u9FFF\uF900-\uFDFF\uFE70-\uFEFE\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFDC]/;
linestylefilter.REGEX_URLCHAR = new RegExp('('+/[-:@a-zA-Z0-9_.,~%+\/\\?=&#;()$]/.source+'|'+linestylefilter.REGEX_WORDCHAR.source+')');
linestylefilter.REGEX_URL = new RegExp(/(?:(?:https?|s?ftp|ftps|file|smb|afp|nfs|(x-)?man|gopher|txmt):\/\/|mailto:)/.source+linestylefilter.REGEX_URLCHAR.source+'*(?![:.,;])'+linestylefilter.REGEX_URLCHAR.source, 'g');

linestylefilter.getURLFilter = function(lineText, textAndClassFunc) {
  linestylefilter.REGEX_URL.lastIndex = 0;
  var urls = null;
  var splitPoints = null;
  var execResult;
  while ((execResult = linestylefilter.REGEX_URL.exec(lineText))) {
    if (! urls) {
      urls = [];
      splitPoints = [];
    }
    var startIndex = execResult.index;
    var url = execResult[0];
    urls.push([startIndex, url]);
    splitPoints.push(startIndex, startIndex + url.length);
  }

  if (! urls) return textAndClassFunc;

  function urlForIndex(idx) {
    for(var k=0; k<urls.length; k++) {
      var u = urls[k];
      if (idx >= u[0] && idx < u[0]+u[1].length) {
	return u[1];
      }
    }
    return false;
  }

  var handleUrlsAfterSplit = (function() {
    var curIndex = 0;
    return function(txt, cls) {
      var txtlen = txt.length;
      var newCls = cls;
      var url = urlForIndex(curIndex);
      if (url) {
	newCls += " url:"+url;
      }
      textAndClassFunc(txt, newCls);
      curIndex += txtlen;
    };
  })();

  return linestylefilter.textAndClassFuncSplitter(handleUrlsAfterSplit,
                                                  splitPoints);
};

linestylefilter.textAndClassFuncSplitter = function(func, splitPointsOpt) {
  var nextPointIndex = 0;
  var idx = 0;

  // don't split at 0
  while (splitPointsOpt &&
	 nextPointIndex < splitPointsOpt.length &&
	 splitPointsOpt[nextPointIndex] == 0) {
    nextPointIndex++;
  }

  function spanHandler(txt, cls) {
    if ((! splitPointsOpt) || nextPointIndex >= splitPointsOpt.length) {
      func(txt, cls);
      idx += txt.length;
    }
    else {
      var splitPoints = splitPointsOpt;
      var pointLocInSpan = splitPoints[nextPointIndex] - idx;
      var txtlen = txt.length;
      if (pointLocInSpan >= txtlen) {
	func(txt, cls);
	idx += txt.length;
	if (pointLocInSpan == txtlen) {
	  nextPointIndex++;
	}
      }
      else {
	if (pointLocInSpan > 0) {
	  func(txt.substring(0, pointLocInSpan), cls);
	  idx += pointLocInSpan;
	}
	nextPointIndex++;
	// recurse
	spanHandler(txt.substring(pointLocInSpan), cls);
      }
    }
  }
  return spanHandler;
};

// domLineObj is like that returned by domline.createDomLine
linestylefilter.populateDomLine = function(textLine, aline, apool,
                                           domLineObj) {
  // remove final newline from text if any
  var text = textLine;
  if (text.slice(-1) == '\n') {
    text = text.substring(0, text.length-1);
  }

  function textAndClassFunc(tokenText, tokenClass) {
    domLineObj.appendSpan(tokenText, tokenClass);
  }

  var func = textAndClassFunc;
  func = linestylefilter.getURLFilter(text, func);
  func = linestylefilter.getLineStyleFilter(text.length, aline,
                                            func, apool);
  func(text, '');
};
