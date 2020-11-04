// showAppsByCredentialStatus.js
// ------------------------------------------------------------------
//
// Copyright 2017-2020 Google LLC.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// created: Mon Mar 20 09:57:02 2017
// last saved: <2020-November-03 17:36:22>
/* global process */

const edgejs     = require('apigee-edge-js'),
      util       = require('util'),
      common     = edgejs.utility,
      apigee     = edgejs.edge,
      Getopt     = require('node-getopt'),
      version    = '20201103-1648',
      defaults   = { timespan: '30d'},
      getopt     = new Getopt(common.commonOptions.concat([
        ['' , 'timespan=ARG', 'optional. timespan threshold for "soon". Eg, 30d, 40w, 1y,... Default: ' + defaults.timespan]
      ])).bindHelp();


class Resolver {
  static multipliers() { return {s: 1, m: 60, h : 60*60, d:60*60*24, w: 60*60*24*7, y: 60*60*24*365}; }
  static timespanPattern() { return new RegExp('^([1-9][0-9]*)([smhdwy])$','i'); }
  static isValidTimespan(subject) {
    return Resolver.timespanPattern().exec(subject);
  }
  /*
   * convert a simple timespan string, expressed in days, hours, minutes, or
   * seconds, such as 30d, 12d, 8h, 24h, 45m, 30s, into a numeric quantity in
   * milliseconds.
   */
  static resolveExpiry(subject) {
    let match = Resolver.timespanPattern().exec(subject);
    if (match) {
      return match[1] * Resolver.multipliers()[match[2]] * 1000;
    }
    return -1;
  }
}


/* partition an array via a predicate */
const partition = (array, predicate) =>
  array.reduce(([pass, fail], elem) =>
               (predicate(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]]), [[], []]);


// ========================================================

console.log(
  'Apigee Edge showAppsByCredentialStatus.js tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

let appliedTimespan = opt.options.timespan || defaults.timespan;
if ( ! Resolver.isValidTimespan(appliedTimespan)) {
  appliedTimespan = defaults.timespan;
}
let timespan = Resolver.resolveExpiry(appliedTimespan);
let expiryDate = new Date((new Date()).getTime() + timespan);
if (opt.options.verbose) {
  common.logWrite('looking for apps expiring before ' + expiryDate.toISOString());
}
let expiry = expiryDate.getTime();

apigee.connect(common.optToOptions(opt))
  .then(org =>
    org.apps.get({expand:true})
      .then(result => {
        let apps = result.app
          .map(app => ({name:app.name, creds:app.credentials.map( ({consumerKey, expiresAt}) => ({consumerKey, expiresAt}))}));

        if (opt.options.verbose) {
          common.logWrite('found %d apps for that org', apps.length);
        }

        const [appsNoExpiry, appsWithExpiry] = partition(apps, app => app.creds.find(cred => cred.expiresAt == -1));
        common.logWrite('apps with no expiry (%d): %s', appsNoExpiry.length, JSON.stringify(appsNoExpiry, null, 2));

        let now = (new Date()).getTime();
        const [appsAlreadyExpired, appsWillExpire] =
          partition(appsWithExpiry, app => app.creds.find(cred => cred.expiresAt < now));

        common.logWrite('apps with expired credentials (%d): %s', appsAlreadyExpired.length, JSON.stringify(appsAlreadyExpired, null, 2));

        let appsExpiringSoon =
          appsWillExpire
          .filter(app => app.creds.find(cred => cred.expiresAt < expiry))
          .map(({name, creds}) => ({name, creds:creds.map(cred => ({...cred, expires:(new Date(cred.expiresAt)).toISOString()}))}));

        common.logWrite('apps expiring within %s (%d): %s',
                        appliedTimespan, appsExpiringSoon.length, JSON.stringify(appsExpiringSoon, null, 2));
      }))
  .catch( e => console.error('error: ' + util.format(e) ) );
