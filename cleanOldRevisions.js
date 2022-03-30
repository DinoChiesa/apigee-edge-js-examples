#! /usr/local/bin/node
/* jshint node:true, esversion:9, strict:implied */
// cleanOldRevisions.js
// ------------------------------------------------------------------
// In Apigee Edge, for all proxies or sharedflows in an org, remove all
// but the latest N revisions. (Never remove a deployed revision).
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
// last saved: <2022-January-24 13:54:06>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      sprintf  = require('sprintf-js').sprintf,
      Getopt   = require('node-getopt'),
      pLimit   = require('p-limit'),
      util     = require('util'),
      version  = '20210421-1603',
      getopt   = new Getopt(common.commonOptions.concat([
        ['R' , 'regexp=ARG', 'Optional. Cull only proxies with names matching this regexp.'],
        ['K' , 'numToKeep=ARG', 'Required. Max number of revisions of each proxy to retain.'],
        ['S' , 'sharedflows', 'Optional. Cull only sharedflows, not apiproxies.']
      ])).bindHelp();

// ========================================================

console.log(
  `Apigee Proxy / Sharedflow revision cleaner tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

process.on('unhandledRejection',
            r => console.log('\n*** unhandled promise rejection: ' + util.format(r)));

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

function examineRevisions(collection, name, revisions) {
    common.logWrite('revisions %s: %s', name, JSON.stringify(revisions));
    if (revisions && revisions.length > opt.options.numToKeep) {
      revisions.sort( (a, b) => b - a );
      revisions.reverse();
      let revisionsToExamine = revisions.slice(0, revisions.length - opt.options.numToKeep);
      revisionsToExamine.reverse();

      // limit the number of concurrent requests
      const limit = pLimit(4);

      const mapper =
        revision => limit( _ => {
        const options = { name, revision };
        return collection.getDeployments(options)
          .then( deployments => {
            if (opt.options.verbose) {
              common.logWrite('deployments (%s r%s): %s', name, revision, JSON.stringify(deployments));
            }
            return (! deployments.environment || deployments.environment.length === 0) ?
              collection.del(options).then ( _ => revision ) : null;
          });
      });

      return Promise.all(revisionsToExamine.map(mapper))
        .then ( revisions => {
          revisions = revisions.filter( r => r);
          if (opt.options.verbose) {
            common.logWrite("deleted %s: %s", name, JSON.stringify(revisions));
          }
          return {item:name, revisions};
        } );
    }
    return null;
}


common.verifyCommonRequiredParameters(opt.options, getopt);

if ( !opt.options.numToKeep ) {
  console.log('You must specify a number of revisions to retain. (-K)');
  getopt.showHelp();
  process.exit(1);
}

apigee.connect(common.optToOptions(opt))
  .then ( org => {
    let readOptions = {};
    const collectionName = (opt.options.sharedflows) ? "sharedflows" : "proxies";
    const collection = (opt.options.sharedflows) ? org.sharedflows : org.proxies;

    return collection.get(readOptions)
      .then( results => {
        if (opt.options.regexp) {
          const re1 = new RegExp(opt.options.regexp);
          results = results.filter( item => re1.test(item) );
        }
        if (results) {
          // convert for GAAMBO
          if (results.proxies && results.proxies.length) {
            results = results.proxies.map(r => r.name);
          }
        }
        if ( !results || results.length == 0) {
          common.logWrite('No %s%s', (opt.options.regexp)?"matching ":"", collectionName);
          return Promise.resolve(true);
        }

        if (opt.options.verbose) {
          console.log(JSON.stringify(results, null, 2));
          common.logWrite('found %d %s%s', results.length, (opt.options.regexp)?"matching ":"", collectionName);
        }

        const reducer = (promise, itemname) =>
          promise.then( accumulator =>
                        collection.getRevisions({ name: itemname })
                        .then( async (r) => {
                          const x = await examineRevisions(collection, itemname, r);
                          return [ ...accumulator, x ] ;
                        })
                      );

        return results
            .reduce(reducer, Promise.resolve([]))
            .then( a => {
              a = a.filter( x => !!x );
              common.logWrite('summary deleted: ' + JSON.stringify(a));
            });
      });
  })
  .catch( e => console.error('error: ' + util.format(e) ) );
