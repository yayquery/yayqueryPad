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

// import("jsutils.eachProperty");
//
// function _paramObjectToParamArray(params, enc) {
//   var pa = [];
//   eachProperty(params, function(k, v) {
//     pa.push(enc ? encodeURIComponent(k.toString()) : k.toString());
//     pa.push(enc ? encodeURIComponent(v.toString()) : v.toString());
//   });
//   return pa;
// }

/**
 * Simple way to send an email to a single recipient. Emails will have a
 * "from" address of <code>noreply@{appjet.appName}.{appjet.mainDomain}</code>.
 *
 * Sending is limited to 100 emails per developer account per day.  However,
 * emails sent to the address on file for the app's owner are not counted
 * toward this limit.
 *
 * @example
result = sendEmail("noone@example.com", "Test Subject",
                   "Greetings!", {"Reply-To": "sender@example.com"});
 *
 * @param {strings} toAddress An array of email address strings, or a single string.
 * @param {string} subject The message subject.
 * @param {string} body The message body.
 * @param {object} [headers] Optional headers to include in the
 * message, as a dictionary of {name: value} entries.
 */
function sendEmail(toAddress, fromAddress, subject, headers, body) {
  if (typeof(toAddress) == 'string')
    toAddress = [toAddress];
  var ret = Packages.net.appjet.ajstdlib.email.sendEmail(toAddress, fromAddress, subject, headers, body);
  if (ret != "")
    throw new Error(ret);
}

