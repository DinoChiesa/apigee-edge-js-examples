// credentialsTool.js
// ------------------------------------------------------------------
//
// Copyright 2017-2022 Google LLC.
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
// last saved: <2022-August-19 10:39:03>
/* global process */

const apigeejs   = require('apigee-edge-js'),
      util       = require('util'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      Getopt     = require('node-getopt'),
      version    = '20220819-0952',
      defaults   = { timespan: 'none'},
      getopt     = new Getopt(common.commonOptions.concat([
        ['' , 'timespan=ARG', 'optional. timespan threshold. Eg, 30d, 40w, 1y,... Default: ' + defaults.timespan],
        ['' , 'action=ARG', 'Required. Use one of:\n          deleteExpired - delete expired credentials. Works only with credentials that are expired, not those soon to expire.\n          list - just list the apps with expired credentials, or the apps with credentials that will expire soon.\n          listNoExpiry - list the apps with credentials with no expiry.\n          listNoCreds - list the apps with no credentials.']

      ])).bindHelp();


class Resolver {
  static multipliers() { return {s: 1, m: 60, h : 60*60, d:60*60*24, w: 60*60*24*7, y: 60*60*24*365}; }
  static timespanPattern() { return new RegExp('^(-?[1-9][0-9]*)([smhdwy])$','i'); }
  static isValidTimespan(subject) {
    return Resolver.timespanPattern().exec(subject);
  }
  /*
   * convert a simple timespan string, expressed in days, hours, minutes, or
   * seconds, such as 30d, 12d, 8h, 24h, 45m, 30s, into a numeric quantity in
   * milliseconds. Can also use negative numbers.
   */
  static resolveExpiry(subject) {
    if (subject) {
      let match = Resolver.timespanPattern().exec(subject);
      if (match) {
        return match[1] * Resolver.multipliers()[match[2]] * 1000;
      }
    }
    return 0;
  }
}

/* partition an array via a predicate */
const partition = (array, predicate) =>
  array.reduce(([pass, fail], elem) =>
               (predicate(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]]), [[], []]);

// ========================================================

console.log(
  'Apigee credentials tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);


if ( opt.options.action != 'list' &&
     opt.options.action != 'listNoExpiry' &&
     opt.options.action != 'listNoCreds' &&
     opt.options.action != 'deleteExpired') {
  common.logWrite('you must specify an action, one of {deleteExpired, list, listNoExpiry, listNoCreds}');
  process.exit(1);
}

if (opt.options.action == 'listNoExpiry' && opt.options.timespan) {
  common.logWrite('do not specify a timespan with listNoExpiry');
  process.exit(1);
}
if (opt.options.action == 'listNoCreds' && opt.options.timespan) {
  common.logWrite('do not specify a timespan with listNoCreds');
  process.exit(1);
}

let appliedTimespan = opt.options.timespan || defaults.timespan;
if ( ! Resolver.isValidTimespan(appliedTimespan)) {
  appliedTimespan = null;
}
let timespan = Resolver.resolveExpiry(appliedTimespan);

// If the timespan is negative, that means look into the future.  Used for
// listing creds that will expire soon.  If the timespan is positive, the tool
// looks back - eg to find creds that expired at least XX days ago.
// If timespan is zero, then it finds creds that are expired as of "now".

if (opt.options.action == 'deleteExpired' && timespan < 0) {
  common.logWrite('do not specify a negative timespan with delete ');
  process.exit(1);
}

let expiryDate = new Date((new Date()).getTime() - timespan);
let expiryDateInt = expiryDate.getTime();

if (opt.options.verbose) {
  if (opt.options.action == 'listNoExpiry') {
    common.logWrite('looking for app credentials that have no expiry');
  }
  else if (opt.options.action == 'listNoCreds') {
    common.logWrite('looking for app credentials that have no expiry');
  }
  else if (timespan < 0) {
    common.logWrite('looking for app credentials that will expire before ' + expiryDate.toISOString());
  }
  else {
    common.logWrite('looking for app credentials that expired before ' + expiryDate.toISOString());
  }
}

apigee.connect(common.optToOptions(opt))
  .then(org =>
        org.apps.get({expand:true})
        .then(result => {
          //console.log(JSON.stringify(result, null, 2));
          let apps = result.app
            .map(app => ({
              name:app.name,
              developerId:app.developerId,
              creds:( ! app.credentials || !app.credentials.length)?[]:
                app.credentials.map( ({consumerKey, expiresAt}) => ({
                  consumerKey,
                  expiresAt,
                  expires:((expiresAt == -1)?'never':((new Date(Number(expiresAt))).toISOString()))
                }))
            }));

          common.logWrite('found %d apps for that org', apps.length);

          if (opt.options.action == 'listNoCreds') {
            let [appsWithCreds, appsNoCreds] = partition(apps, app => app.creds.length>0);
            common.logWrite('found %d app%s with zero credentials', appsNoCreds.length, (appsNoCreds.length == 1)?'':'s');
            if (appsNoCreds.length) {
              common.logWrite(JSON.stringify(appsNoCreds, null, 2));
            }
            return;
          }

          let [appsWithExpiry, appsNoExpiry] = partition(apps, app => app.creds.some(cred => cred.expiresAt != -1));
          if (opt.options.action == 'listNoExpiry') {
            common.logWrite('found %d app%s with at least one credential that does not expire', appsNoExpiry.length, (appsNoExpiry.length == 1)?'':'s');
            if (appsNoExpiry.length) {
              common.logWrite(JSON.stringify(appsNoExpiry, null, 2));
            }
            return;
          }

          // remaining cases: list or deleteExpired
          const [appsWithCredsThatExpireBefore, appsWithCredsThatExpireAfter] =
            partition(apps, app => app.creds.some(cred => (cred.expiresAt != -1) && (cred.expiresAt < expiryDateInt)));

          if (appsWithCredsThatExpireBefore.length) {
            if (opt.options.action == 'list') {

              if (timespan < 0) {
                // looking forward (soon to expire)
                let now = (new Date()).getTime();
                const [appsExpireBeforeNow, appsWithCredsThatExpireAfterNow] =
                  partition(appsWithCredsThatExpireBefore, app => app.creds.some(cred => (Number(cred.expiresAt) == -1) || cred.expiresAt < now));

                // Do not list the creds that are already expired. Not interesting.
                // Just list those that  are not yet expired, but will expire soon.
                common.logWrite('found %d app%s with credentials that will expire before %s',
                                appsWithCredsThatExpireAfterNow.length,
                                (appsWithCredsThatExpireAfterNow.length == 1)?'':'s',
                                expiryDate.toISOString());
                common.logWrite(JSON.stringify(appsWithCredsThatExpireAfterNow, null, 2));
              }
              else {
                // looking back (already expired)
                common.logWrite('found %d app%s with credentials that expired before %s',
                                appsWithCredsThatExpireBefore.length,
                                (appsWithCredsThatExpireBefore.length == 1)?'':'s',
                                expiryDate.toISOString());
                common.logWrite(JSON.stringify(appsWithCredsThatExpireBefore, null, 2));
              }
            }
            else {
              // deleteExpired
              common.logWrite('found %d app%s with credentials that expire%s before %s',
                              appsWithCredsThatExpireBefore.length,
                              (appsWithCredsThatExpireBefore.length == 1)?'':'s',
                              (timespan>=0)? 'd':'',
                              expiryDate.toISOString());

              const appReducer = function(promise, {developerId, name, creds}) {
                      const credReducer = function (promise, cred) {
                              return promise .then( a => {
                                if (cred.expiresAt < expiryDateInt) {
                                  return org.appcredentials
                                    .del({appName:name, developerId, consumerKey:cred.consumerKey})
                                    .then( result => [ ...a, result ] );
                                }
                                return a;
                              });
                            };

                      return promise.then(a => creds .reduce(credReducer, Promise.resolve([a])));
                    };

              common.logWrite('removing the credentials...');
              return appsWithCredsThatExpireBefore
                .reduce(appReducer, Promise.resolve([]))
                .then( result => console.log(JSON.stringify(result, null, 2)));
            }
          }
          else {
            common.logWrite('found 0 apps with credentials that expire%s before %s',
                            (timespan>=0)? 'd':'',
                            expiryDate.toISOString());

          }
        }))
  .catch( e => console.error('error: ' + util.format(e) ) );
