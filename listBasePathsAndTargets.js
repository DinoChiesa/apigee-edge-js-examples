#! /usr/local/bin/node
/*jslint node:true, esversion:9 */
// listBasePathsAndTargets.js
// ------------------------------------------------------------------
//
// Copyright 2018-2022 Google LLC.
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
// last saved: <2022-December-05 11:38:09>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      util     = require('util'),
      sprintf  = require('sprintf-js').sprintf,
      AdmZip   = require('adm-zip'),
      DOM      = require('@xmldom/xmldom').DOMParser,
      xpath    = require('xpath'),
      Getopt   = require('node-getopt'),
      version  = '20221205-1038',
      getopt   = new Getopt(common.commonOptions.concat([
        ['' , 'proxypattern=ARG', 'Optional. a regular expression. Look only in proxies that match this regexp.'],
        ['' , 'filter=ARG', 'Optional. filter the set of proxies. valid values: (deployed, deployed:envname, latest).']
      ])).bindHelp();

const isFilterLatestRevision = () => opt.options.filter == 'latest';
const isFilterDeployed = () => opt.options.filter == 'deployed';
const isFilterDeployedEnv = () => opt.options.filter && opt.options.filter.startsWith('deployed:') && opt.options.filter.slice(9);

function isKeeper(opt) {
  if (opt.options.proxypattern) {
    if (opt.options.verbose) {
      common.logWrite('using regex match (%s)',opt.options.proxypattern);
    }
    return name => name.match(new RegExp(opt.options.proxypattern));
  }
  return () => true;
}

const revisionMapper = (org, name) =>
  revision =>
  org.proxies.export({ name, revision })
  .then( result => {
    let zip = new AdmZip(result.buffer),
        re1 = new RegExp('^apiproxy/proxies/[^/]+.xml$');
    let proxyEndpoints = zip
      .getEntries()
      .filter( entry => entry.entryName.match(re1))
      .map( entry => {
        let data = entry.getData().toString('utf8'),
            doc = new DOM().parseFromString(data),
            endpointName = xpath.select('/ProxyEndpoint/@name', doc)[0].value,
            nodeset = xpath.select('/ProxyEndpoint/HTTPProxyConnection/BasePath', doc),
            theNode = nodeset && nodeset[0],
            firstChild = theNode && theNode.firstChild,
            basePath = firstChild && firstChild.data;
        return {
          proxy: endpointName,
          basePath: basePath || 'unknown',
          adminPath: sprintf('/apis/%s/revisions/%s/proxies/%s', name, revision, endpointName)
        };
      });
    let re2 = new RegExp('^apiproxy/targets/[^/]+.xml$');
    let targetEndpoints = zip
      .getEntries()
      .filter( entry => entry.entryName.match(re2))
      .map( entry => {
        let data = entry.getData().toString('utf8'),
            doc = new DOM().parseFromString(data),
            endpointName = xpath.select('/TargetEndpoint/@name', doc)[0].value,
            httpTargetConnNodeset = xpath.select('/TargetEndpoint/HTTPTargetConnection', doc);
        if (httpTargetConnNodeset && httpTargetConnNodeset[0]) {
          let urlNodeset = xpath.select('/TargetEndpoint/HTTPTargetConnection/URL', doc);
          if (urlNodeset && urlNodeset[0]) {
            let theNode = urlNodeset && urlNodeset[0],
                firstChild = theNode && theNode.firstChild,
                url = firstChild && firstChild.data;
            return {
              target: endpointName,
              url: url || 'unknown',
              adminPath: sprintf('/apis/%s/revisions/%s/targets/%s', name, revision, endpointName)
            };
          }
          let lbNodeset = xpath.select('/TargetEndpoint/HTTPTargetConnection/LoadBalancer', doc);
          let theNode = lbNodeset && lbNodeset[0];
          if (theNode) {
            let serverNodeset = xpath.select('/TargetEndpoint/HTTPTargetConnection/LoadBalancer/Server/@name', doc);

            let servers = serverNodeset.map(node => node.value);

            return {
              target: endpointName,
              url: 'load-balancer: ' + servers.join(', '),
              adminPath: sprintf('/apis/%s/revisions/%s/targets/%s', name, revision, endpointName)
            };
          }
          return null;
        }
        let localTargetConnNodeset = xpath.select('/TargetEndpoint/LocalTargetConnection', doc);
        if (localTargetConnNodeset && localTargetConnNodeset[0]) {
          let apiproxy = xpath.select('/TargetEndpoint/LocalTargetConnection/APIProxy', doc);
          if (apiproxy) {
            let theNode = apiproxy && apiproxy[0],
                firstChild = theNode && theNode.firstChild,
                proxyName = firstChild && firstChild.data;
            return {
              target: endpointName,
              proxyName: proxyName || 'unknown',
              adminPath: sprintf('/apis/%s/revisions/%s/targets/%s', name, revision, endpointName)
            };
          }
          let pathNodeset = xpath.select('/TargetEndpoint/LocalTargetConnection/Path', doc);
            let theNode = pathNodeset && pathNodeset[0],
                firstChild = theNode && theNode.firstChild,
                path = firstChild && firstChild.data;
            return {
              target: endpointName,
              path: path || 'unknown',
              adminPath: sprintf('/apis/%s/revisions/%s/targets/%s', name, revision, endpointName)
            };
        }
      });

    return proxyEndpoints.concat(targetEndpoints).filter(e => !!e);

  });

const revisionReducer = fn =>
 (p, revision) =>
    p.then( accumulator =>
            fn(revision)
            .then( endpoint => [...accumulator, { revision, endpoint }]));


const toRevisions = org =>
 (promise, name) =>
  promise .then( accumulator => {
    if (isFilterDeployedEnv() || isFilterDeployed()) {
      let environment = isFilterDeployedEnv();
      return org.proxies.getDeployments({ name, environment })
        .then( response => {
          if (response.deployments) {
            // GAAMBO
            let deployments = response.deployments.map( d => ({name, revision:[d.revision], environment:d.environment}));
            return [...accumulator, ...deployments];
          }
          if (response.revision) {
            // Admin API
            let deployments = response.revision.map( r => ({name, revision:[r.name]}));
            return [...accumulator, ...deployments];
          }
          return accumulator;
        })
        .catch( e => {
          if (e.code == "distribution.ApplicationNotDeployed") {
            return accumulator;
          }
          throw e;
        });
    }

    return org.proxies.get({ name })
      .then( ({revision}) => {
        if (isFilterLatestRevision()) {
          revision = [revision.pop()];
        }
        return [ ...accumulator, {name, revision} ];
      });
});


// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee listBasePathsAndTargets.js tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

if (opt.options.filter && !isFilterLatestRevision() && !isFilterDeployed() && !isFilterDeployedEnv()) {
  console.log("It looks like you've specified an invalid filter.");
  getopt.showHelp();
  process.exit(1);
}


common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
  .connect(common.optToOptions(opt))
  .then(org =>
    org.proxies.get()
        .then( apiproxies => {
          // for gaambo
          if (Array.isArray(apiproxies.proxies)) {
            apiproxies = apiproxies.proxies.map(p => p.name);
          }
          if (opt.options.verbose) {
            common.logWrite('total count of API proxies for that org: %d', apiproxies.length);
          }
          return apiproxies
            .filter( isKeeper(opt) )
            .sort()
            .reduce( toRevisions(org), Promise.resolve([]));
        })
        .then( candidates => {
          //console.log('candidates: ' + JSON.stringify(candidates, null, 2));
          let r = (p, nameAndRevisions) =>
          p.then( accumulator => {
            let mapper = revisionMapper(org, nameAndRevisions.name);
            return nameAndRevisions.revision
              .reduce(revisionReducer(mapper), Promise.resolve([]))
              .then( a => [...accumulator, {proxyname: nameAndRevisions.name, found:a.map(e => ({environment: nameAndRevisions.environment, ...e }))}]);
        });
        return candidates.reduce(r, Promise.resolve([]));
      })
  )

  .then( r => console.log('' + JSON.stringify(r, null, 2)) )

  .catch( e => console.log('while executing, error: ' + e.stack) );
