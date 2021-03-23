#! /usr/local/bin/node
/*jslint node:true */
// undeployAndMaybeDelete.js
// ------------------------------------------------------------------
// undeploy and maybe delete an Apigee Edge proxy that has a name with a specific prefix.
//
// Copyright 2017-2021 Google LLC.
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
// last saved: <2021-March-23 08:51:26>
/* jslint esversion:9 */

const apigeejs   = require('apigee-edge-js'),
      util       = require('util'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      Getopt     = require('node-getopt'),
      version    = '20210323-0851',
      getopt     = new Getopt(common.commonOptions.concat([
        ['A' , 'all', 'optional. Undeploy (and optionally delete) all API Proxies.' ],
        ['P' , 'prefix=ARG', 'optional. Undeploy (and optionally delete) API Proxies with names starting with this prefix.' ],
        ['R' , 'regex=ARG', 'optional. Undeploy (and optionally delete) API Proxies with names that match this regex.' ],
        ['e' , 'env=ARG', 'optional. the environment(s) from which to undeploy. Separate multiple environments with a comma. default: all'],
        ['t' , 'trial', 'trial only. Do not actually undeploy or delete'],
        ['D' , 'delete', 'optional. Delete the proxies too. By default, just undeploy.' ]
      ])).bindHelp();

// ========================================================

function getNameMatcher(options) {
  if ( ! options.prefix && ! options.all && ! options.regex) {
    console.log('You must specify one of -P, -A, or -R');
    getopt.showHelp();
    process.exit(1);
  }

  if ((options.prefix && options.all) ||
      (options.prefix && options.regex) ||
      (options.all && options.regex)) {
    console.log('You must specify at most one of -P, -A, or -R');
    getopt.showHelp();
    process.exit(1);
  }

  if (options.prefix)
    return s => s.startsWith(options.prefix);
  if (options.all)
    return s => true;
  if ( ! options.regex)
    throw new Error('missing option');

  let re = new RegExp(options.regex);
  return s => s.match(re);
}

function revEnvReducer(options, org, envs, name, revision) {
  return (p, deployment) => {
    //console.log('deployment: ' + util.format(deployment));
    return p.then( _ => {
      let environment = deployment.environment || deployment.name;
      if (!envs || envs.indexOf(environment) >= 0) {
        let args = {name, revision, environment};
        return options.trial ? (console.log('WOULD UNDEPLOY ' + JSON.stringify(args)) && {}) :
          org.proxies.undeploy(args);
      }
      return {};
    });
  };
}

function revReducer(options, org, envs, name) {
  return (p, revision) =>
    p.then( _ =>
            org.proxies.getDeployments({ name, revision })
            // to support GAAMBO or classic API
            .then( r => r.deployments || r.environment)
            .then( deployments => {
              //console.log('deployments: ' + util.format(deployments));
              return (deployments && deployments.length > 0) ?
                deployments.reduce(revEnvReducer(options, org, envs, name, revision), Promise.resolve()) : {};
            }));
}

console.log(
  'Apigee Edge Proxy Undeploy + Delete tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');

let opt = getopt.parse(process.argv.slice(2));

let proxyMatcher = getNameMatcher(opt.options);

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then( org =>
    org.proxies.get()
      .then( r => {
        //console.log('r: ' + JSON.stringify(r));
        // to support GAAMBO or classic API
        let [collection, predicate] = (r.proxies) ?
          [r.proxies, p => proxyMatcher(p.name)] :
          [r, p => proxyMatcher(p)];

        const envs = opt.options.env && opt.options.env.split(','); // env may be a comma-separated list

        let proxyReducer = (p, item) =>
        p.then( _ =>
            // to support GAAMBO or classic API
            org.proxies.getRevisions({ name: item.name || item})
            .then( revisions =>
                   revisions.reduce(revReducer(opt.options, org, envs, item.name || item), Promise.resolve()))
                .then( _ => {
                  if (opt.options.delete) {
                    let args = { name: item.name || item};
                    return opt.options.trial ? (console.log('WOULD DELETE ' + JSON.stringify(args)) && {}) :
                      org.proxies.del(args);
                  }
                  return {};
                }));

        return collection
          .filter( p => predicate(p))
          .reduce(proxyReducer, Promise.resolve()) ;
      })
      .then( results => common.logWrite('all done...') )
  )
  .catch( e => console.log(util.format(e)));
