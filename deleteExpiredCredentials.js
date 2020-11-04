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
// last saved: <2020-November-03 18:23:18>
/* global process */

const edgejs     = require('apigee-edge-js'),
      util       = require('util'),
      common     = edgejs.utility,
      apigee     = edgejs.edge,
      Getopt     = require('node-getopt'),
      version    = '20201103-1759',
      defaults   = { timespan: '30d'},
      getopt     = new Getopt(common.commonOptions.concat([
        ['' , 'doit', 'Optional. actually make the desired changes.']
      ])).bindHelp();

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

        common.logWrite('apps with expired credentials (%d): %s',
                        appsWithExpiredCreds.length, JSON.stringify(appsWithExpiredCreds, null, 2));

        let expiredCreds =
          appsWithExpiredCreds
          .reduce((a, {name, developerId, creds}) => {
            creds = creds.filter(cred => cred.expiresAt < now && cred.expiresAt != -1);
            return (creds.length > 0)? a.concat(creds.map(cred => ({name, developerId, cred}))) : a;
          }, []);

        common.logWrite('expired credentials: %s',
                        expiredCreds.length, JSON.stringify(expiredCreds, null, 2));

        if (opt.options.doit) {
          const reducer = (promise, {developerId, name, cred}) =>
            promise .then( a =>
                           org.appcredentials
                           .del({appName:name, developerId, consumerKey:cred.consumerKey})
                           .then( result => [ ...a, result ] ));

          return expiredCreds
            .reduce(reducer, Promise.resolve([]))
            .then( result => console.log(JSON.stringify(result, null, 2)));
        }

      }))
  .catch( e => console.error('error: ' + util.format(e) ) );
