// findTargetBadSslInfo.js
// ------------------------------------------------------------------
//
// Copyright 2018-2021 Google LLC.
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
// last saved: <2021-October-07 13:19:23>
/* global process */

const edgejs     = require('apigee-edge-js'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      util       = require('util'),
      Getopt     = require('node-getopt'),
      version    = '20211007-1319',
      targetType = {
        HTTP : 'httpConnection',
        NODE : 'scriptConnection',
        HOSTED : 'hostedTarget'
      },
      getopt     = new Getopt(common.commonOptions.concat([
        ['R' , 'regexp=ARG', 'Optional. Restrict the search to proxies with names that match regexp.'],
        ['L' , 'latest', 'Optional. Restrict the search to only the latest revision of each proxy.']
      ])).bindHelp();

const flaggedTarget =
  (connection) => {
    let isHttp = connection && connection.connectionType == targetType.HTTP,
        flagged = false;
    if (isHttp) {
      if (!connection.sSLInfo) {
        flagged = "No SSLInfo";
      }
      else if ( !connection.sSLInfo.enabled || String(connection.sSLInfo.enabled) == "false") {
        flagged = "SSLInfo.enabled = false";
      }
      else if (String(connection.sSLInfo.ignoreValidationErrors) == "true") {
        flagged = "SSLInfo.ignoreValidationErrors = true";
      }
      else if ( ! connection.sSLInfo.trustStore) {
        flagged = "No Truststore";
      }
    }
    return flagged;
  };

function examineTargets(collection, proxyName, revision, targets) {
  const reducer = (promise, target) =>
    promise.then( accumulator =>
                  collection.getTarget({
                    apiproxy: proxyName,
                    revision,
                    target
                  })
                  .then( t => {
                    let r = flaggedTarget(t.connection);
                    return (r) ?
                      [ ...accumulator, {name:target, reasonFlagged: r}] :  accumulator;
                  }));

  return targets.reduce(reducer, Promise.resolve([]))
    .then ( t => (t.length) ? {revision, targets: t} : null );
}

function examineRevisions(collection, proxyName, revisions) {
  if (opt.options.verbose) {
    common.logWrite('revisions of %s: %s', proxyName, JSON.stringify(revisions));
  }

  if (revisions && revisions.length) {
    if (opt.options.latest) {
      revisions.sort( (a, b) => b - a );
      revisions = revisions.slice(0, 1);
    }
    const reducer = (promise, revision) =>
      promise.then( accumulator =>
                    collection.getTargets({ name: proxyName, revision })
                    .then( async (targets) => {
                      if (opt.options.verbose) {
                        if (targets && targets.length) {
                          common.logWrite('%s r%s targets: %s', proxyName, revision, JSON.stringify(targets));
                        }
                        else {
                          common.logWrite('%s r%s: no targets', proxyName, revision);
                        }
                      }
                      if (targets && targets.length) {
                        const x = await examineTargets(collection, proxyName, revision, targets);
                        return [ ...accumulator, x ];
                      }
                      return Promise.resolve(accumulator);
                    })
                  );

    return revisions.reduce(reducer, Promise.resolve([]))
      .then ( r => {
        r = r.filter( e => !!e );
        return (r.length) ? {"proxy": proxyName, revisions: r } : null;
      } );
  }
  return null;
}

// ========================================================

process.on('unhandledRejection',
            r => console.log('\n*** unhandled promise rejection: ' + util.format(r)));

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee Edge findTargetBadSslInfo.js tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigeeEdge.connect(common.optToOptions(opt))
  .then (org =>
         org.proxies.get()
         .then( result => {
           if (opt.options.regexp) {
             const re1 = new RegExp(opt.options.regexp);
             result = result.filter( item => re1.test(item) );
           }
           if ( !result || result.length == 0) {
             common.logWrite('No %sproxies', (opt.options.regexp)?"matching ":"");
             return Promise.resolve(true);
           }

           if (opt.options.verbose) {
             common.logWrite('found %d %sAPI proxies for that org', result.length, (opt.options.regexp)?"matching ":"");
           }

           const reducer = (promise, itemname) =>
             promise.then( accumulator =>
                           org.proxies.getRevisions({ name: itemname })
                           .then( async (revisions) => {
                             const x = await examineRevisions(org.proxies, itemname, revisions);
                             return [ ...accumulator, x ] ;
                           })
                         );
           return result
             .reduce(reducer, Promise.resolve([]))
             .then( a => {
               const r = {
                       report: 'Proxies with bad SSLInfo',
                       search: (opt.options.latest)? 'latest revision': 'all revisions',
                       org: opt.options.org,
                       now: (new Date()).toISOString(),
                       found: a.filter( x => !!x )
                     };
               console.log('\n' + JSON.stringify(r, null, 2));
             });
         })
        )
  .catch( e => console.log(util.format(e)));
