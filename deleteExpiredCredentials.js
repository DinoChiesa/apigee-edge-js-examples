// deleteExpiredCredentials.js
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
// last saved: <2020-November-04 08:21:06>
/* global process */

const edgejs     = require('apigee-edge-js'),
      util       = require('util'),
      common     = edgejs.utility,
      apigee     = edgejs.edge,
      Getopt     = require('node-getopt'),
      version    = '20201103-1759',
      defaults   = { timespan: '0d'},
      getopt     = new Getopt(common.commonOptions.concat([
        ['' , 'timespan=ARG', 'optional. timespan threshold for "soon". Eg, 30d, 40w, 1y,... Default: ' + defaults.timespan],
        ['' , 'doit', 'Optional. actually make the desired changes.']
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
  'Apigee Edge deleteExpiredCredentials.js tool, version: ' + version + '\n' +
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
let expiryDate = new Date((new Date()).getTime() - timespan);
if (opt.options.verbose) {
  common.logWrite('looking for apps expired before ' + expiryDate.toISOString());
}
let expiryCutoff = expiryDate.getTime();
if ( ! opt.options.doit) {
  common.logWrite('will not make any changes...');
}

apigee.connect(common.optToOptions(opt))
  .then(org =>
    org.apps.get({expand:true})
      .then(result => {
        let apps = result.app
          .map(app => ({
            name:app.name,
            developerId:app.developerId,
            creds:app.credentials.map( ({consumerKey, expiresAt}) => ({
              consumerKey,
              expiresAt,
              expires:((expiresAt == -1)?'never':((new Date(expiresAt)).toISOString()))
            }))
          }));

        common.logWrite('found %d apps for that org', apps.length);

        let [appsWithExpiry, appsNoExpiry] = partition(apps, app => app.creds.some(cred => cred.expiresAt != -1));

        let now = (new Date()).getTime();
        const [appsWithExpiredCreds, appsWillExpire] =
          partition(appsWithExpiry, app => app.creds.some(cred => cred.expiresAt < now));

        common.logWrite('found %d apps with expired credentials', appsWithExpiredCreds.length);
        if (opt.options.verbose) {
          common.logWrite(JSON.stringify(appsWithExpiredCreds, null, 2));
        }

        let expiredCreds =
          appsWithExpiredCreds
          .reduce((a, {name, developerId, creds}) => {
            creds = creds.filter(cred => cred.expiresAt < now && cred.expiresAt != -1);
            return (creds.length > 0)? a.concat(creds.map(cred => ({name, developerId, cred}))) : a;
          }, []);

        common.logWrite('found %d expired credentials', expiredCreds.length);
        if (opt.options.verbose) {
          common.logWrite(JSON.stringify(expiredCreds, null, 2));
        }

        let expiredBeforeCutoff = expiredCreds .filter( item => item.cred.expiresAt < expiryCutoff);

        common.logWrite('found %d credentials expired prior to %s ago',
                        expiredBeforeCutoff.length,
                        appliedTimespan);

        if (opt.options.verbose && expiredBeforeCutoff.length) {
          common.logWrite(JSON.stringify(expiredBeforeCutoff, null, 2));
        }
        if (expiredBeforeCutoff.length) {
          if (opt.options.doit) {
            const reducer = (promise, {developerId, name, cred}) =>
              promise .then( a =>
                             org.appcredentials
                             .del({appName:name, developerId, consumerKey:cred.consumerKey})
                             .then( result => [ ...a, result ] ));
            common.logWrite('removing them...');
            return expiredBeforeCutoff
              .reduce(reducer, Promise.resolve([]))
              .then( result => console.log(JSON.stringify(result, null, 2)));
          }
          else {
            common.logWrite('not making any changes... (see the --doit option)');
          }
        }
        else {
          common.logWrite('nothing to do...');
        }

      }))
  .catch( e => console.error('error: ' + util.format(e) ) );
