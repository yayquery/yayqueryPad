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

import("fastJSON");
import("netutils");
import("funhtml.*");
import("stringutils.{html,sprintf,startsWith,md5}");
import("jsutils.*");
import("sqlbase.sqlbase");
import("sqlbase.sqlcommon");
import("sqlbase.sqlobj");
import("dispatch.{Dispatcher,PrefixMatcher,DirMatcher,forward}");

import("etherpad.globals.*");
import("etherpad.utils.*");
import("etherpad.sessions.getSession");
import("etherpad.sessions");
import("etherpad.statistics.statistics");
import("etherpad.log");
import("etherpad.usage_stats.usage_stats");
import("etherpad.helpers");

//----------------------------------------------------------------
// Usagestats
//----------------------------------------------------------------

var _defaultPrefs = {
  topNCount: 5,
  granularity: 1440
}

function onRequest() {
  keys(_defaultPrefs).forEach(function(prefName) {
    if (request.params[prefName]) {
      _prefs()[prefName] = request.params[prefName];
    }
  });
  if (request.isPost) {
    response.redirect(
      request.path+
      (request.query ? "?"+request.query : "")+
      (request.params.fragment ? "#"+request.params.fragment : ""));
  }
}

function _prefs() {
  if (! sessions.getSession().statsPrefs) {
    sessions.getSession().statsPrefs = {}
  }
  return sessions.getSession().statsPrefs;
}

function _pref(pname) {
  return _prefs()[pname] || _defaultPrefs[pname];
}

function _topN() {
  return _pref('topNCount');
}
function _showLiveStats() {
  return _timescale() < 1440;
  // return _pref('granularity') == 'live';
}
function _showHistStats() {
  return _timescale() >= 1440
  // return _pref('showLiveOrHistorical') == 'hist';
}
function _timescale() {
  return Number(_pref('granularity')) || 1;
}

// types:
//   compare - compare one or more single-value stats
//   top - show top values over time
//   histogram - show histogram over time

var statDisplays = {
  users: [
      { name: "visitors", 
        description: "User visits, total over a %t period",
        type: "compare",
        stats: [ {stat: "site_pageviews",
                  description: "Page views",
                  color: "FFA928" },
                 {stat: "site_unique_ips",
                  description: "Unique IPs",
                  color: "00FF00" } ] },

  // free pad usage
      { name: "free pad usage, 1 day",
        description: "Free etherpad.com users, total over a %t period",
        type: "compare",
        stats: [ {stat: "active_user_ids",
                  description: "All users",
                  color: "FFA928" },
                 {stat: "users_1day_returning_7days",
                  description: "Users returning after 7 days",
                  color: "00FF00"},
                 {stat: "users_1day_returning_30days",
                  description: "Users returning after 30 days",
                  color: "FF0000"} ] }, 
      { name: "free pad usage, 7 day",
        description: "Free etherpad.com users over the last 7 days",
        type: "compare",
        options: { hideLive: true, latestUseHistorical: true},
        stats: [ {stat: "active_user_ids_7days",
                  description: "All users",
                  color: "FFA928" },
                 {stat: "users_7day_returning_7days",
                  description: "Users returning after 7 days",
                  color: "00FF00"},
                 {stat: "users_7day_returning_30days",
                  description: "Users returning after 30 days",
                  color: "FF0000"} ] },
      { name: "free pad usage, 30 day",
        description: "Free etherpad.com users over the last 30 days",
        type: "compare",
        options: { hideLive: true, latestUseHistorical: true},
        stats: [ {stat: "active_user_ids_30days",
                  description: "All users",
                  color: "FFA928" },
                 {stat: "users_30day_returning_7days",
                  description: "Users returning after 7 days",
                  color: "00FF00"},
                 {stat: "users_30day_returning_30days",
                  description: "Users returning after 30 days",
                  color: "FF0000"} ] },

  // pro pad usage
      { name: "active pro accounts, 1 day",
        description: "Active pro accounts, total over a %t period",
        type: "compare",
        stats: [ {stat: "active_pro_accounts",
                  description: "All accounts",
                  color: "FFA928" },
                 {stat: "pro_accounts_1day_returning_7days",
                  description: "Accounts older than 7 days",
                  color: "00FF00"},
                 {stat: "pro_accounts_1day_returning_30days",
                  description: "Accounts older than 30 days",
                  color: "FF0000"} ] },
      { name: "active pro accounts, 7 day",
        description: "Active pro accounts over the last 7 days",
        type: "compare",
        options: { hideLive: true, latestUseHistorical: true},
        stats: [ {stat: "active_pro_accounts_7days",
                  description: "All accounts",
                  color: "FFA928" },
                 {stat: "pro_accounts_7day_returning_7days",
                  description: "Accounts older than 7 days",
                  color: "00FF00"},
                 {stat: "pro_accounts_7day_returning_30days",
                  description: "Accounts older than 30 days",
                  color: "FF0000"} ] },
      { name: "active pro accounts, 30 day",
        description: "Active pro accounts over the last 30 days",
        type: "compare",
        options: { hideLive: true, latestUseHistorical: true},
        stats: [ {stat: "active_pro_accounts_30days",
                  description: "All accounts",
                  color: "FFA928" },
                 {stat: "pro_accounts_30day_returning_7days",
                  description: "Accounts older than 7 days",
                  color: "00FF00"},
                 {stat: "pro_accounts_30day_returning_30days",
                  description: "Accounts older than 30 days",
                  color: "FF0000"} ] },

  // other stats
      { name: "pad connections",
        description: "Number of active comet connections, mean over a %t period",
        type: "top",
        options: {showOthers: false},
        stats: ["streaming_connections"] },
      { name: "referers",
        description: "Referers, number of hits over a %t period",
        type: "top",
        options: {showOthers: false},
        stats: ["top_referers"] },
    ],
  product: [
      { name: "pads",
        description: "Newly-created and active pads, total over a %t period",
        type: "compare",
        stats: [ {stat: "active_pads",
                  description: "Active pads",
                  color: "FFA928" },
                 {stat: "new_pads",
                  description: "New pads",
                  color: "FF0000" }] },
      { name: "chats",
        description: "Chat messages and active chatters, total over a %t period",
        type: "compare",
        stats: [ {stat: "chat_messages",
                  description: "Messages",
                  color: "FFA928" },
                 {stat: "active_chatters",
                  description: "Chatters",
                  color: "FF0000" }] },
      { name: "import/export",
        description: "Imports and Exports, total over a %t period",
        type: "compare",
        stats: [ {stat: {f: '+', args: ["imports_exports_counts:export", "imports_exports_counts:import"]},
                  description: "Total",
                  color: "FFA928" },
                 {stat: "imports_exports_counts:export",
                  description: "Exports",
                  color: "FF0000"},
                 {stat: "imports_exports_counts:import",
                  description: "Imports",
                  color: "00FF00"}] },
      { name: "revenue",
        description: "Revenue, total over a %t period",
        type: "compare",
        stats: [ {stat: "revenue",
                  description: "Revenue",
                  color: "FFA928"}] }
    ],
  performance: [
      { name: "dynamic page latencies",
        description: "Slowest dynamic pages: mean load time in milliseconds over a %t period",
        type: "top",
        options: {showOthers: false},
        stats: ["execution_latencies"] },
      { name: "pad startup latencies",
        description: "Pad startup times: percent load time in milliseconds over a %t period",
        type: "histogram",
        stats: ["pad_startup_times"] },
      { name: "stream post latencies",
        description: "Comet post latencies, percentiles in milliseconds over a %t period",
        type: "histogram",
        stats: ["streaming_latencies"] },    
    ],
  health: [
      { name: "disconnect causes",
        description: "Causes of disconnects, total over a %t period",
        type: "top",
        stats: ["disconnect_causes"] },
      { name: "paths with 404s",
        description: "'Not found' responses, by path, number served over a %t period",
        type: "top",
        stats: ["paths_404"] },
      { name: "exceptions",
        description: "Total number of server exceptions over a %t period",
        type: "compare",
        stats: [ {stat: "exceptions",
                  description: "Exceptions",
                  color: "FF1928" } ] },
      { name: "paths with 500s",
        type: "top",    
        description: "'500' responses, by path, number served over a %t period",
        type: "top",
        stats: ["paths_500"] },
      { name: "paths with exceptions",
        description: "responses with exceptions, by path, number served over a %t period",
        type: "top",
        stats: ["paths_exception"] },
      { name: "disconnects with client-side errors",
        description: "user disconnects with an error on the client side, number over a %t period",
        type: "compare",
        stats: [ { stat: "disconnects_with_clientside_errors",
                   description: "Disconnects with errors",
                   color: "FFA928" } ] },
      { name: "unnecessary disconnects",
        description: "disconnects that were avoidable, number over a %t period",
        type: "compare",
        stats: [ { stat: "streaming_disconnects:disconnected_userids",
                   description: "Number of unique users disconnected",
                   color: "FFA928" },
                 { stat: "streaming_disconnects:total_disconnects",
                   description: "Total number of disconnects",
                   color: "FF0000" } ] },  
  ]
}

function getUsedStats(statStructure) {
  var stats = {};
  function getStructureValues(statStructure) {
    if (typeof(statStructure) == 'string') {
      stats[statStructure] = true;
    } else {
      statStructure.args.forEach(getStructureValues);
    }
  }
  getStructureValues(statStructure);
  return keys(stats);
}

function getStatData(statStructure, values_f) {
  function getStructureValues(statStructure) {
    if (typeof(statStructure) == 'string') {
      return values_f(statStructure);
    } else if (typeof(statStructure) == 'number') {
      return statStructure;
    } else {
      var args = statStructure.args.map(getStructureValues);
      return {
        f: statStructure.f,
        args: args
      }
    }
  }
  
  var mappedStructure = getStructureValues(statStructure);
  
  function evalStructure(statStructure) {
    if ((typeof(statStructure) == 'number') || (statStructure instanceof Array)) {
      return statStructure;
    } else {
      var merge_f = statStructure.f;
      if (typeof(merge_f) == 'string') {
        switch (merge_f) {
          case '+':
            merge_f = function() {
              var sum = 0;
              for (var i = 0; i < arguments.length; ++i) {
                sum += arguments[i];
              }
              return sum;
            }
            break;
          case '*':
            merge_f = function() {
              var product = 0;
              for (var i = 0; i < arguments.length; ++i) {
                product *= arguments[i];
              }
              return product;
            }
            break;
          case '/':
            merge_f = function(a, b) { return a / b; }
            break;
          case '-':
            merge_f = function(a, b) { return a - b; }
            break;
        }
      }
      var evaluatedArguments = statStructure.args.map(evalStructure);
      var length = -1;
      evaluatedArguments.forEach(function(arg) {
        if (typeof(arg) == 'object' && (arg instanceof Array)) {
          length = arg.length;
        }
      });
      evaluatedArguments = evaluatedArguments.map(function(arg) {
        if (typeof(arg) == 'number') {
          var newArg = new Array(length);
          for (var i = 0; i < newArg.length; ++i) {
            newArg[i] = arg;
          }
          return newArg
        } else {
          return arg;
        }
      });
      return mergeArrays.apply(this, [merge_f].concat(evaluatedArguments));
    }
  }
  return evalStructure(mappedStructure);
}

var googleChartSimpleEncoding = "ABCDEFGHIJLKMNOPQRSTUVQXYZabcdefghijklmnopqrstuvwxyz0123456789-.";
function _enc(value) {
  return googleChartSimpleEncoding[Math.floor(value/64)] + googleChartSimpleEncoding[value%64];
}

function drawSparkline(dataSets, labels, colors, minutes) {
  var max = 1;
  var maxLength = 0;
  dataSets.forEach(function(dataSet, i) {
    if (dataSet.length > maxLength) {
      maxLength = dataSet.length;
    }
    dataSet.forEach(function(point) {
      if (point > max) {
        max = point;
      }
    });
  });
  var data = dataSets.map(function(dataSet) {
    var chars = dataSet.map(function(x) {
      if (x !== undefined) {
        return _enc(Math.round(x/max*4095));
      } else {
        return "__";
      }
    }).join("");
    while (chars.length < maxLength*2) {
      chars = "__"+chars;
    }
    return chars;
  }).join(",");
  var timeLabels;
  if (minutes < 60*24) {
    timeLabels = [4,3,2,1,0].map(function(t) {
      var minutesPerTick = minutes/4;
      var d = new Date(Date.now() - minutesPerTick*60000*t);
      return (d.getHours()%12 || 12)+":"+(d.getMinutes() < 10 ? "0" : "")+d.getMinutes()+(d.getHours() < 12 ? "am":"pm");
    }).join("|");
  } else {
    timeLabels = [4,3,2,1,0].map(function(t) {
      var daysPerTick = (minutes/(60*24))/4;
      var d = new Date(Date.now() - t*daysPerTick*24*60*60*1000);
      return (d.getMonth()+1)+"/"+d.getDate();
    }).join("|");
  }
  var pointLabels = dataSets.map(function(dataSet, i) {
    return ["t"+dataSet[dataSet.length-1],colors[i],i,maxLength-1,12,0].join(",");
  }).join("|");
  labels = labels.map(function(label) {
    return encodeURIComponent((label.length > 73) ? label.slice(0, 70) + "..." : label);
  });
  var step = Math.round(max/10);
  step = Math.round(step/Math.pow(10, String(step).length-1))*Math.pow(10, String(step).length-1);
  var srcUrl = 
    "http://chart.apis.google.com/chart?chs=600x300&cht=lc&chd=e:"+data+
    "&chxt=y,x&chco="+colors.join(",")+"&chxr=0,0,"+max+","+step+"&chxl=1:|"+timeLabels+
    "&chdl="+labels.join("|")+"&chdlp=b&chm="+pointLabels;
  return toHTML(IMG({src: srcUrl}));
}

var liveDataNumSamples = 20;

function extractStatValuesFunction(nameToValues_f) {
  return function(statName) {
    var value;
    if (statName.indexOf(":") >= 0) {
      [statName, value] = statName.split(":");
    }
    var h = nameToValues_f(statName);
    if (value) {
      h = h.map(function(topValues) {
        if (! topValues) { return; }
        var tv = topValues.topValues;
        for (var i = 0; i < tv.length; ++i) {
          if (tv[i].value == value) {
            return tv[i].count;
          }
        }
        return 0;
      });
    }
    return h;
  }
}

function sparkline_compare(history_f, minutesPerSample, stat) {
  var histories = stat.stats.map(function(stat) {
      var samples = getStatData(stat.stat, extractStatValuesFunction(history_f));
      return [samples, stat.description, stat.color];
    });
  return drawSparkline(histories.map(function(history) { return history[0] }),
                       histories.map(function(history) { return history[1] }),
                       histories.map(function(history) { return history[2] }),
                       minutesPerSample*histories[0][0].length);
}

function sparkline_top(history_f, minutesPerSample, stat) {
  var showOthers = ! stat.options || stat.options.showOthers != false;
  var history = stat.stats.map(history_f)[0]; 

  if (history.length == 0) {
    return "<b>no data</b>";
  }
  var topRecents = {};
  var topRecents_arr = [];
  history.forEach(function(tv) {
    if (! tv) { return; }
    if (tv.topValues.length > 0) {
      topRecents_arr = tv.topValues.map(function(x) { return x.value; });
    }
  });
  
  if (topRecents_arr.length == 0) {
    return "<b>no data</b>";
  }
  topRecents_arr = topRecents_arr.slice(0, _topN());
  topRecents_arr.forEach(function(value, i) {
    topRecents[value] = i;
  });
  
  if (showOthers) {
    topRecents_arr.push("Other");    
  }
  var max = 1;
  var values = topRecents_arr.map(function() { return history.map(function() { return 0 }); });

  history.forEach(function(tv, i) {
    if (! tv) { return; }
    tv.topValues.forEach(function(entry) {
      if (entry.count > max) {
        max = entry.count;
      }
      if (entry.value in topRecents) {
        values[topRecents[entry.value]][i] = entry.count;
      } else if (showOthers) {
        values[values.length-1][i] += entry.count;
      }
    });
  });
  return drawSparkline(
    values, 
    topRecents_arr, 
    ["FF0000", "00FF00", "0000FF", "FF00FF", "00FFFF"].slice(0, topRecents_arr.length-1).concat("FFA928"),
    minutesPerSample*history.length);
}

function sparkline_histogram(history_f, minutesPerSample, stat) {
  var history = stat.stats.map(history_f)[0]; 

  if (history.length == 0) {
    return "<b>no data</b>";
  }
  var percentiles = [50, 90, 95, 99];
  var data = percentiles.map(function() { return []; })
  history.forEach(function(hist) {
    percentiles.forEach(function(pct, i) {
      data[i].push((hist ? hist[""+pct] : undefined));
    });
  });
  return drawSparkline(
    data,
    percentiles.map(function(pct) { return ""+pct+"%"; }),
    ["FF0000","FF00FF","FFA928","00FF00"].reverse(),
    minutesPerSample*history.length);
}

function liveHistoryFunction(minutesPerSample) {
  return function(statName) {
    return statistics.liveSnapshot(statName).history(minutesPerSample, liveDataNumSamples);
  }
}

function _listStats(statName, count) {
  var options = { orderBy: '-timestamp,id' };
  if (count !== undefined) {
    options.limit = count;
  }
  return sqlobj.selectMulti('statistics', {name: statName}, options);
}

function ancientHistoryFunction(time) {
  return function(statName) {
    var seenDates = {};
    var samples = _listStats(statName);
    
    samples = samples.reverse().map(function(json) {
      if (seenDates[""+json.timestamp]) { return; }
      seenDates[""+json.timestamp] = true;
      return {timestamp: json.timestamp, json: json.value};
    }).filter(function(x) { return x !== undefined });

    samples = samples.reverse().slice(0, Math.round(time/(24*60)));
    var samplesWithEmptyValues = [];
    for (var i = 0; i < samples.length-1; ++i) {
      var current = samples[i];
      var next = samples[i+1];
      samplesWithEmptyValues.push(current.json);
      for (var j = current.timestamp+86400*1000; j < next.timestamp; j += 86400*1000) {
        samplesWithEmptyValues.push(undefined);
      }
    }
    if (samples.length > 0) {
      samplesWithEmptyValues.push(samples[samples.length-1].json);      
    }
    samplesWithEmptyValues = samplesWithEmptyValues.map(function(json) {
      if (! json) { return; }
      var obj = fastJSON.parse(json);
      if (keys(obj).length == 1 && 'value' in obj) {
        obj = obj.value;
      }
      return obj;
    });

    return samplesWithEmptyValues.reverse();
  }
}

function sparkline(history_f, minutesPerSample, stat) {
  if (this["sparkline_"+stat.type]) {
    return this["sparkline_"+stat.type](history_f, minutesPerSample, stat);
  } else {
    return "<b>No sparkline handler!</b>";
  }
}

function liveLatestFunction(minutesPerSample) {
  return function(statName) {
    return [statistics.liveSnapshot(statName).latest(minutesPerSample)];
  }
}

function liveTotal(statName) {
  return [statistics.liveSnapshot(statName).total];
}

function historyLatest(statName) {
  return _listStats(statName, 1).map(function(x) { 
    var value = fastJSON.parse(x.value);
    if (keys(value).length == 1 && 'value' in value) {
      value = value.value;
    }
    return value;
  });
}

function latest_compare(latest_f, stat) {
  return stat.stats.map(function(stat) {
    var sample = getStatData(stat.stat, extractStatValuesFunction(latest_f))[0];
    return { value: sample, description: stat.description };
  });
}

function latest_top(latest_f, stat) {
  var showOthers = ! stat.options || stat.options.showOthers != false;
  
  var sample = stat.stats.map(latest_f)[0][0];
  if (! sample) {
    return [];
  }
  var total = sample.count;
  
  var values = sample.topValues.slice(0, _topN()).map(function(v) {
    total -= v.count;
    return { value: v.count, description: v.value };
  });
  if (showOthers) {
    values.push({value: total, description: "Other"});
  }
  return values;
}

function latest_histogram(latest_f, stat) {
  var sample = stat.stats.map(latest_f)[0][0];

  if (! sample) {
    return "<b>no data</b>";
  } 
  
  var percentiles = [0, 1, 5, 10, 25, 50, 75, 90, 95, 99, 100].filter(function(pct) { return ((""+pct) in sample) });

  var xpos = percentiles.map(function(x, i) { return sample[x] });
  var xMax = 0;
  var xMin = 1e12;
  xpos.forEach(function(x) { xMax = (x > xMax ? x : xMax); xMin = (x < xMin ? x : xMin); });
  xposNormalized = xpos.map(function(x) { return Math.round((x-xMin)/(xMax-xMin || 1)*100); });

  var ypos = percentiles.slice(1).map(function(y, i) { return (y-percentiles[i])/(xpos[i+1] || 1); });
  var yMax = 0;
  ypos.forEach(function(y) { yMax = (y > yMax ? y : yMax); });
  yposNormalized = ypos.map(function(y) { return Math.round(y/yMax*100); });

  // var proposedLabels = mergeArrays(function(x, y) { return {pos: x, label: y}; }, xposNormalized, xpos);
  // var keepLabels = [{pos: 0, label: 0}];
  // proposedLabels.forEach(function(label) {
  //   if (label.pos - keepLabels[keepLabels.length-1].pos > 10) {
  //     keepLabels.push(label);
  //   }
  // });
  // 
  // var labelPos = keepLabels.map(function(x) { return x.pos });
  // var labels = keepLabels.map(function(x) { return x.label });

  return toHTML(IMG({src: 
    "http://chart.apis.google.com/chart?chs=340x100&cht=lxy&chd=t:"+xposNormalized.join(",")+"|0,"+yposNormalized.join(",")+
    "&chxt=x&chxr=0,"+xMin+","+xMax+","+Math.floor((xMax-xMin)/5)  // "l=0:|"+labels.join("|")+"&chxp=0,"+labelPos.join(",")
  }));
}

function latest(latest_f, stat) {
  if (this["latest_"+stat.type]) {
    return this["latest_"+stat.type](latest_f, stat);
  } else {
    return "<b>No latest handler!</b>";
  }
}

function dropdown(name, options, selected) {
  var select;
  if (typeof(name) == 'string') {
    select = SELECT({name: name});
  } else {
    select = SELECT(name);
  }
  
  function addOption(value, content) {
    var opt = OPTION({value: value}, content || value);
    if (value == selected) {
      opt.attribs.selected = "selected";
    }
    select.push(opt);
  }
  
  if (options instanceof Array) {
    options.forEach(f_limitArgs(this, addOption, 1));
  } else {
    eachProperty(options, addOption);
  }
  return select;
}

function render_main() {
  var categoriesToStats = {};
  
  eachProperty(statDisplays, function(catName, statArray) {
    categoriesToStats[catName] = statArray.map(_renderableStat);
  });
  
  renderHtml('statistics/stat_page.ejs', 
    {eachProperty: eachProperty,
     statCategoryNames: keys(categoriesToStats),
     categoriesToStats: categoriesToStats,
     optionsForm: _optionsForm() });
}

function _optionsForm() {
  return FORM({id: "statprefs", method: "POST"}, "Show data with granularity: ",
              // dropdown({name: 'showLiveOrHistorical', onchange: 'formChanged();'}, 
              //          {live: 'live', hist: 'historical'}, 
              //          _pref('showLiveOrHistorical')),
              // (_showLiveStats() ? 
               // SPAN(" with granularity ",
                    dropdown({name: 'granularity', onchange: 'formChanged();'},
                             {"1": '1 minute', "5": '5 minutes', "60": '1 hour', "1440": '1 day'},
                             _pref('granularity')), // ),
              // : ""),
              " top N:",
              INPUT({type: "text", name: "topNCount", value: _topN()}),
              INPUT({type: "submit", name: "Set", value: "set N"}),
              INPUT({type: "hidden", name: "fragment", id: "fragment", value: "health"}));
}

// function render_main() {
//   var body = BODY();
// 
//   var cat = request.params.cat;
//   if (!cat) {
//     cat = 'health';
//   }
// 
//   body.push(A({id: "backtoadmin", href: "/ep/admin/"}, html("&laquo;"), " back to admin"));
//   body.push(_renderTopnav(cat));
// 
//   body.push(form);
// 
//   if (request.params.stat) {
//     body.push(A({className: "viewall",
//       href: qpath({stat: null})}, html("&laquo;"), "  view all"));
//   }
// 
//   var statNames = statDisplays[cat];
//   statNames.forEach(function(sn) {
//     if (!request.params.stat || (request.params.stat == sn)) {
//       body.push(_renderableStat(sn));
//     }
//   });
// 
//   helpers.includeCss('admin/admin-stats.css');
//   response.write(HTML(HEAD(html(helpers.cssIncludes())), body));
// }

function _getLatest(stat) {
  var minutesPerSample = _timescale();

  if (_showLiveStats()) {
    return latest(liveLatestFunction(minutesPerSample), stat);
  } else {
    return latest(liveTotal, stat);
  }
}

function _getGraph(stat) {
  var minutesPerSample = _timescale();

  if (_showLiveStats()) {
    return html(sparkline(liveHistoryFunction(minutesPerSample), minutesPerSample, stat));
  } else {
    return html(sparkline(ancientHistoryFunction(60*24*60), 24*60, stat));
  }
}

function _getDataLinks(stat) {
  if (_showLiveStats()) {
    return;
  }
  
  function listToLinks(list) {
    var links = []; //SPAN({className: "datalink"}, "(data for ");
    list.forEach(function(statName) {
      links.push(toHTML(A({href: "/ep/admin/usagestats/data?statName="+statName}, statName)));
    });
//    links.push(")");
    return links;
  }
  
  switch (stat.type) {
    case 'compare':
      var stats = [];
      stat.stats.map(function(stat) { return getUsedStats(stat.stat); }).forEach(function(list) {
        stats = stats.concat(list);
      });
      return listToLinks(stats);
    case 'top':
      return listToLinks(stat.stats);
    case 'histogram':
      return listToLinks(stat.stats);
  }
}

function _renderableStat(stat) {
  var minutesPerSample = _timescale();

  var period = (_showLiveStats() ? minutesPerSample : 24*60);
  
  if (period < 24*60 && stat.hideLive) {
    return;
  }
  
  if (period < 60) {
    period = ""+period+"-minute";
  } else if (period < 24*60) {
    period = ""+period/(60)+"-hour";
  } else if (period >= 24*60) {
    period = ""+period/(24*60)+"-day";
  }
  var graph = _getGraph(stat);
  var id = stat.name.replace(/[^a-zA-Z0-9]/g, "");

  var displayName = stat.description.replace("%t", period);
  var latest = _getLatest(stat);
  var dataLinks = _getDataLinks(stat);
  
  return {
    id: id,
    specialState: "",
    displayName: displayName,
    name: stat.name,
    graph: graph,
    latest: latest,
    dataLinks: dataLinks
  }
}

function render_data() {
  var sn = request.params.statName;
  var t = TABLE({border: 1, cellpadding: 2, style: "font-family: monospace;"});
  _listStats(sn).forEach(function(s) {
    var tr = TR();
    tr.push(TD((s.id)));
    tr.push(TD((new Date(s.timestamp * 1000)).toString()));
    tr.push(TD(s.value));
    t.push(tr);
  });
  response.write(HTML(BODY(t)));
}


// function renderStat(body, statName) {
//   var div = DIV({className: 'statbox'});
//   div.push(A({className: "stat-title", href: qpath({stat: statName})},
//               statName, descriptions[statName] || ""));
//   if (_showHistStats()) {
//     div.push(
//       DIV({className: "stat-graph"},
//         A({href: '/ep/admin/usagestats/graph?size=1080x420&statName='+statName},
//                IMG({src: '/ep/admin/usagestats/graph?size=400x200&statName='+statName,
//                     style: 'border: 1px solid #ccc; margin: 10px 0 0 20px;'})),
//              BR(),
//              DIV({style: 'text-align: right;'},
//                  A({style: 'text-decoration: none; font-size: .8em;',
//                     href: '/ep/admin/usagestats/data?statName='+statName}, "(data)")))
//       );
//   }
//   if (_showLiveStats()) {
//     var data = statistics.getStatData(statName);
//     var displayData = statistics.liveSnapshot(data);
//     var t = TABLE({border: 0});
//     var tcount = 0;
//     ["minute", "hour", "fourHour", "day"].forEach(function(timescale) {
//       if (! _showTimescale(timescale)) { return; }
//       var tr = TR();
//       t.push(tr);
//       tr.push(TD({valign: "top"}, B("Last ", timescale)));
//       var td = TD();
//       var cell = SPAN();
//       tr.push(td);
//       td.push(cell);
//       switch (data.plotType) {
//         case 'line':
//           cell.push(B(displayData[timescale])); break;
//         case 'topValues':
//           var top = displayData[timescale].topValues;
//           if (tcount != 0) {
//             tr[0].attribs.style = cell.attribs.style = "border-top: 2px solid black;";
//           }
//           // println(statName+" / top length: "+top.length);
//           for (var i = 0; i < Math.min(_topN(), top.length); ++i) {
//             cell.push(B(top[i].count), ": ", top[i].value, BR());
//           }
//           break;
//         case 'histogram':
//           var percentiles = displayData[timescale];
//           var pcts = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
//           var max = percentiles["100"] || 1000;
//           cell.push(IMG({src: "http://chart.apis.google.com/chart?chs=340x100&cht=bvs&chd=t:"+
//                             pcts.map(function(pct) { return Math.round(percentiles[""+pct]/max*100); }).join(",")+
//                             "&chxt=x,y&chxl=0:|"+
//                             pcts.map(function(pct) { return ""+pct+"%"; }).join("|")+
//                             "&chxr=0,0,100|1,0,"+max+""}))
//           // td.push("50%: ", B(percentiles["50"]), " ",
//           //         "90%: ", B(percentiles["90"]), " ",
//           //         "max: ", B(percentiles["100"]));
//           break;
//       }
//       tcount++;
//     });
//     div.push(DIV({className: "stat-table"}, t));
//     div.push(html(helpers.clearFloats()));
//   }
//   body.push(div);
// }
// =======
// >>>>>>> Stashed changes:etherpad/src/etherpad/control/statscontrol.js


// old output.

// 
// function getStatsForCategory(category) {
//   var statnames = statistics.getAllStatNames();
//   
//   var matchingStatNames = [];
//   statnames.forEach(function(sn) {
//     if (statistics.getStatData(sn).category == category) {
//       matchingStatNames.push(sn);
//     }
//   });
//   
//   return matchingStatNames;
// }
// 
// function renderCategoryList() {
//   var body = BODY();
// 
//   catNames = getCategoryNames();
//   body.push(P("Please select a statistics category:"));
//   catNames.sort().forEach(function(catname) {
//     body.push(P(A({href: "/ep/admin/usagestats/?cat="+catname}, catname)));
//   });
//   response.write(body);
// }
// 
// function getCategoryNames() {
//   var statnames = statistics.getAllStatNames();
//   var catNames = {};
//   statnames.forEach(function(sn) {
//     catNames[statistics.getStatData(sn).category] = true;
//   });
//   return keys(catNames);
// }
// 
// function dropdown(name, options, selected) {
//   var select;
//   if (typeof(name) == 'string') {
//     select = SELECT({name: name});
//   } else {
//     select = SELECT(name);
//   }
//   
//   function addOption(value, content) {
//     var opt = OPTION({value: value}, content || value);
//     if (value == selected) {
//       opt.attribs.selected = "selected";
//     }
//     select.push(opt);
//   }
//   
//   if (options instanceof Array) {
//     options.forEach(f_limitArgs(this, addOption, 1));
//   } else {
//     eachProperty(options, addOption);
//   }
//   return select;
// }
// 
// function getCategorizedStats() {
//   var statnames = statistics.getAllStatNames();
//   var categories = {}
//   statnames.forEach(function(sn) {
//     var category = statistics.getStatData(sn).category
//     if (! categories[category]) {
//       categories[category] = [];
//     }
//     categories[category].push(statistics.getStatData(sn));
//   });
//   return categories;
// }
// 
// function render_ajax() {
//   var categoriesToStats = getCategorizedStats();
//   
//   eachProperty(categoriesToStats, function(catName, statArray) {
//     categoriesToStats[catName] = statArray.map(function(statObject) {
//       return {
//         specialState: "",
//         displayName: statObject.name,
//         name: statObject.name,
//         data: liveStatDisplayHtml(statObject)
//       }
//     })
//   });
//   
//   renderHtml('statistics/stat_page.ejs', 
//     {eachProperty: eachProperty,
//      statCategoryNames: keys(categoriesToStats),
//      categoriesToStats: categoriesToStats });
// }

// function render_main() {
//   var body = BODY();
//                         
//   var statNames = statistics.getAllStatNames(); //getStatsForCategory(request.params.cat);
//   statNames.forEach(function(sn) {
//     renderStat(body, sn);
//   });
//   response.write(body);
// }
// 
// var descriptions = {
//   execution_latencies: ", mean response time in milliseconds",
//   static_file_latencies: ", mean response time in milliseconds",
//   pad_startup_times: ", max response time in milliseconds of fastest N% of requests"
// };
// 
// function liveStatDisplayHtml(statObject) {
//   var displayData = statistics.liveSnapshot(statObject);
//   switch (statObject.plotType) {
//     case 'line':
//       return displayData;
//     case 'topValues':
//       var data = {}
//       eachProperty(displayData, function(timescale, tsdata) {
//         data[timescale] = ""
//         var top = tsdata.topValues;
//         for (var i = 0; i < Math.min(_topN(), top.length); ++i) {
//           data[timescale] += [B(top[i].count), ": ", top[i].value, BR()].map(toHTML).join("");
//         }
//         if (data[timescale] == "") {
//           data[timescale] = "(no data)";
//         }
//       });
//       return data;
//     case 'histogram':
//       var imgs = {}
//       eachProperty(displayData, function(timescale, tsdata) {
//         var percentiles = tsdata;
//         var pcts = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
//         var max = percentiles["100"] || 1000;
//         imgs[timescale] = 
//           toHTML(IMG({src: "http://chart.apis.google.com/chart?chs=400x100&cht=bvs&chd=t:"+
//                            pcts.map(function(pct) { return Math.round(percentiles[""+pct]/max*100); }).join(",")+
//                            "&chxt=x,y&chxl=0:|"+
//                            pcts.map(function(pct) { return ""+pct+"%"; }).join("|")+
//                            "&chxr=0,0,100|1,0,"+max+""}));
//       });
//       return imgs;
//   }  
// }
// 
// function renderStat(body, statName) {
//   var div = DIV({style: 'float: left; text-align: center; margin: 3px; border: 1px solid black;'})
//   div.push(P(statName, descriptions[statName] || ""));
//   if (_showLiveStats()) {
//     var data = statistics.getStatData(statName);
//     var displayData = statistics.liveSnapshot(data);
//     var t = TABLE();
//     var tcount = 0;
//     ["minute", "hour", "fourHour", "day"].forEach(function(timescale) {
//       if (! _showTimescale(timescale)) { return; }
//       var tr = TR();
//       t.push(tr);
//       tr.push(TD("last ", timescale));
//       var td = TD();
//       tr.push(td);
//       switch (data.plotType) {
//         case 'line':
//           td.push(B(displayData[timescale])); break;
//         case 'topValues':
//           var top = displayData[timescale].topValues;
//           if (tcount != 0) {
//             tr[0].attribs.style = td.attribs.style = "border-top: 1px solid gray;";
//           }
//           // println(statName+" / top length: "+top.length);
//           for (var i = 0; i < Math.min(_topN(), top.length); ++i) {
//             td.push(B(top[i].count), ": ", top[i].value, BR());
//           }
//           break;
//         case 'histogram':
//           var percentiles = displayData[timescale];
//           var pcts = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
//           var max = percentiles["100"] || 1000;
//           td.push(IMG({src: "http://chart.apis.google.com/chart?chs=340x100&cht=bvs&chd=t:"+
//                             pcts.map(function(pct) { return Math.round(percentiles[""+pct]/max*100); }).join(",")+
//                             "&chxt=x,y&chxl=0:|"+
//                             pcts.map(function(pct) { return ""+pct+"%"; }).join("|")+
//                             "&chxr=0,0,100|1,0,"+max+""}))
//           // td.push("50%: ", B(percentiles["50"]), " ",
//           //         "90%: ", B(percentiles["90"]), " ",
//           //         "max: ", B(percentiles["100"]));
//           break;
//       }
//       tcount++;
//     });
//     div.push(t)
//   }
//   if (_showHistStats()) {
//     div.push(A({href: '/ep/admin/usagestats/graph?size=1080x420&statName='+statName},
//                IMG({src: '/ep/admin/usagestats/graph?size=400x200&statName='+statName,
//                     style: 'border: 1px solid #ccc; margin: 10px 0 0 20px;'})),
//              BR(),
//              DIV({style: 'text-align: right;'},
//                  A({style: 'text-decoration: none; font-size: .8em;',
//                     href: '/ep/admin/usagestats/data?statName='+statName}, "(data)")));
//   }
//   body.push(div);
// }
// 
// function render_graph() {
//   var sn = request.params.statName;
//   if (!sn) {
//     render404();
//   }
//   usage_stats.respondWithGraph(sn);
// }
// 
// 
// function render_exceptions() {
//   var logNames = ["frontend/exception", "backend/exceptions"];
// }

// function render_updatehistory() {
// 
//   sqlcommon.withConnection(function(conn) {
//     var stmnt = "delete from statistics;";
//     var s = conn.createStatement();
//     sqlcommon.closing(s, function() {
//       s.execute(stmnt);
//     });
//   });
// 
//   var processed = {};
// 
//   function _domonth(y, m) {
//     for (var i = 0; i < 32; i++) {
//       _processStatsDay(y, m, i, processed);
//     }
//   }
// 
//   _domonth(2008, 10);
//   _domonth(2008, 11);
//   _domonth(2008, 12);
//   _domonth(2009, 1);
//   _domonth(2009, 2);
//   _domonth(2009, 3);
//   _domonth(2009, 4);
//   _domonth(2009, 5);
//   _domonth(2009, 6);
//   _domonth(2009, 7);
//     
//   response.redirect('/ep/admin/usagestats');
// }

// function _processStatsDay(year, month, date, processed) {
//   var now = new Date();
//   var day = new Date();
// 
//   for (var i = 0; i < 10; i++) {
//     day.setFullYear(year);
//     day.setDate(date);
//     day.setMonth(month-1);
//   }
// 
//   if ((+day < +now) &&
//       (!((day.getFullYear() == now.getFullYear()) &&
//          (day.getMonth() == now.getMonth()) &&
//          (day.getDate() == now.getDate())))) {
// 
//     var dayNoon = statistics.noon(day);
// 
//     if (processed[dayNoon]) {
//       return;
//     } else {
//       statistics.processLogDay(new Date(dayNoon));
//       processed[dayNoon] = true;
//     }
//   } else {
//     /* nothing */
//   }
// }

