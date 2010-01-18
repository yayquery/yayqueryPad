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

import("jsutils.{scalaF0,scalaF1}");

/**
 * Asynchronously call a function as soon as the current request completes.
 **/
function async(f) {
  Packages.net.appjet.ajstdlib.execution.runAsync(appjet.context, f);
}

function initTaskThreadPool(name, poolSize) {
  Packages.net.appjet.ajstdlib.execution.createNamedTaskThreadPool(name, poolSize);
}

function scheduleTask(poolName, taskName, delayMillis, args) {
  return Packages.net.appjet.ajstdlib.execution.scheduleTaskInPool(poolName, taskName, delayMillis, args);
}

function shutdownAndWaitOnTaskThreadPool(poolName, timeoutMillis) {
  return Packages.net.appjet.ajstdlib.execution.shutdownAndWaitOnTaskThreadPool(poolName, timeoutMillis);
}

function fancyAssEval(initCode, mainCode) {
  function init(runner) {
    Packages.net.appjet.bodylock.BodyLock.evaluateString(
      runner.globalScope(),
      initCode,
      "eval'd code imports",
      1);
  }
  var runner = Packages.net.appjet.oui.ScopeReuseManager.getEmpty(scalaF1(init));
  var ec = new Packages.net.appjet.oui.ExecutionContext(
    new Packages.net.appjet.oui.RequestWrapper(request.underlying),
    null, runner);
  return Packages.net.appjet.oui.ExecutionContextUtils.withContext(ec,
    scalaF0(function() {
      return Packages.net.appjet.bodylock.BodyLock.evaluateString(
        runner.globalScope(),
        mainCode,
        "eval'd code main",
        1);        
    }));
}