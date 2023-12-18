#! /usr/local/bin/node
/*jslint node:true */
// reportSharedFlowUsage.js
// ------------------------------------------------------------------
// In an Apigee organization, find all proxies that include a FlowCallout,
// and optionally a callout to a specific (named) sharedflow.  This uses a
// brute-force client-side search, so it will take a while to run on an org that
// has many proxy revisions.
//
// Copyright 2017-2023 Google LLC.
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
// last saved: <2023-December-18 10:47:02>

const apigeejs = require("apigee-edge-js"),
  common = apigeejs.utility,
  apigee = apigeejs.apigee,
  sprintf = require("sprintf-js").sprintf,
  AdmZip = require("adm-zip"),
  Dom = require("@xmldom/xmldom").DOMParser,
  path = require("path"),
  fs = require("fs"),
  tmp = require("tmp-promise"),
  util = require("util"),
  Getopt = require("node-getopt"),
  version = "20231212-1212",
  getopt = new Getopt(
    common.commonOptions.concat([
      [
        "L",
        "list",
        "Optional. don't report. just list the SharedFlows in the org."
      ],
      [
        "",
        "proxypattern=ARG",
        "Optional. a regular expression. Look only in proxies that match this regexp."
      ],
      [
        "",
        "filter=ARG",
        "Optional. filter the set of proxies. valid values: (deployed, deployed:envname, latest)."
      ]
    ])
  ).bindHelp();

const isFilterLatestRevision = () => opt.options.filter == "latest";
const isFilterDeployed = () => opt.options.filter == "deployed";
const isFilterDeployedEnv = () =>
  opt.options.filter &&
  opt.options.filter.startsWith("deployed:") &&
  opt.options.filter.slice(9);

function isKeeper(opt) {
  if (opt.options.proxypattern) {
    if (opt.options.verbose) {
      common.logWrite("using regex match (%s)", opt.options.proxypattern);
    }
    return (name) => name.match(new RegExp(opt.options.proxypattern));
  }
  return () => true;
}

function getNameOfSharedFlow(root) {
  let elt = root.documentElement;
  let ix = Object.keys(elt.childNodes)
    .filter((key) => key != "length")
    .map((key) => Number(key))
    .reduce(
      (acc, num) =>
        elt.childNodes[num].tagName == "SharedFlowBundle" ? num : acc,
      -1
    );

  return ix >= 0 && elt.childNodes[ix].firstChild.data;
}

const toRevisions = (org) => (promise, name) =>
  promise.then((accumulator) => {
    if (isFilterDeployedEnv() || isFilterDeployed()) {
      let environment = isFilterDeployedEnv();
      return org.proxies
        .getDeployments({ name, environment })
        .then((response) => {
          if (response.deployments) {
            // GAAMBO
            let deployments = response.deployments.map((d) => ({
              name,
              revision: [d.revision],
              environment: d.environment
            }));
            return [...accumulator, ...deployments];
          }
          if (response.revision) {
            // Admin API
            let deployments = response.revision.map((r) => ({
              name,
              revision: [r.name]
            }));
            return [...accumulator, ...deployments];
          }
          return accumulator;
        })
        .catch((e) => {
          if (e.code == "distribution.ApplicationNotDeployed") {
            return accumulator;
          }
          throw e;
        });
    }

    return org.proxies.get({ name }).then(({ revision }) => {
      if (isFilterLatestRevision()) {
        revision = [revision.pop()];
      }
      return [...accumulator, { name, revision }];
    });
  });

// ========================================================

process.on("unhandledRejection", (r) =>
  console.log("\n*** unhandled promise rejection: " + util.format(r))
);
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee Sharedflow report tool, version: ${version}\n` +
      `Node.js ${process.version}\n`
  );

  common.logWrite("start");
}

if (
  opt.options.filter &&
  !isFilterLatestRevision() &&
  !isFilterDeployed() &&
  !isFilterDeployedEnv()
) {
  console.log("It looks like you've specified an invalid filter.");
  getopt.showHelp();
  process.exit(1);
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
  .connect(common.optToOptions(opt))
  .then((org) => {
    if (opt.options.verbose) {
      common.logWrite("connected");
    }
    if (opt.options.list) {
      return org.sharedflows.get({}).then((result) => {
        if (result.sharedFlows) {
          result = result.sharedFlows.map((x) => x.name);
        } // GAAMBO
        return `found ${result.length} sharedflows: ` + result.join(", ");
      });
    }

    return tmp
      .dir({ unsafeCleanup: true, prefix: "findFlowCallouts" })
      .then(async (tmpdir) => {
        const sharedFlows = await org.sharedflows.get({}).then((result) => {
          if (!Array.isArray(result)) {
            // GAAMBO
            if (result.sharedFlows) {
              result = result.sharedFlows.map((x) => x.name);
            } else result = {};
          }
          const arrayToHash = (map, currentValue, index) => (
            (map[currentValue] = []), map
          );
          return result.reduce(arrayToHash, {});
        });

        if (!Object.keys(sharedFlows).length) {
          common.logWrite("There are no sharedflows.");
          return [];
        }

        return org.proxies
          .get({})
          .then((apiproxies) => {
            // for gaambo
            if (Array.isArray(apiproxies.proxies)) {
              apiproxies = apiproxies.proxies.map((p) => p.name);
            }
            if (opt.options.verbose) {
              common.logWrite(
                "total count of API proxies for that org: %d",
                apiproxies.length
              );
            }
            // Starting from the list of proxies, filter to keep only those of
            // interest, then get the revisions of each one (maybe confining the
            // check to only the most recent revision), and then examine the
            // policies or resources in those revisions.
            return apiproxies
              .filter(isKeeper(opt))
              .sort()
              .reduce(toRevisions(org), Promise.resolve([]));
          })
          .then((proxiesAndRevisions) => {
            //common.logWrite('checking...' + JSON.stringify(proxiesAndRevisions));

            const exportOneProxyRevision = (name, revision) =>
              org.proxies.export({ name, revision }).then((result) => {
                let pathOfZip = path.join(tmpdir.path, result.filename);
                fs.writeFileSync(pathOfZip, result.buffer);
                if (opt.options.verbose) {
                  common.logWrite("export ok file: %s", pathOfZip);
                }
                return pathOfZip;
              });

            const unzipRevision = (name, revision) =>
              exportOneProxyRevision(name, revision).then((pathOfZip) => {
                let zip = new AdmZip(pathOfZip);
                let pathOfUnzippedBundle = path.join(
                  tmpdir.path,
                  `proxy-${name}-r${revision}`
                );
                zip.extractAllTo(pathOfUnzippedBundle, false);
                return pathOfUnzippedBundle;
              });

            const searchRevisionForFlowCallouts = (proxyName) => (revision) =>
              unzipRevision(proxyName, revision).then(
                (pathOfUnzippedBundle) => {
                  let policiesDir = path.join(
                    pathOfUnzippedBundle,
                    "apiproxy",
                    "policies"
                  );
                  if (!fs.existsSync(policiesDir)) {
                    return [];
                  }
                  let sharedFlowsCalledByThisRevision = fs
                    .readdirSync(policiesDir)
                    .reduce((acc, name) => {
                      let root = new Dom().parseFromString(
                        fs.readFileSync(path.join(policiesDir, name), "utf-8")
                      );
                      if (root.documentElement.tagName == "FlowCallout") {
                        let sfName = getNameOfSharedFlow(root);
                        if (sfName) {
                          acc.push(sfName);
                        }
                      }
                      return acc;
                    }, []);
                  // uniquify the list of sharedflows
                  return [...new Set(sharedFlowsCalledByThisRevision)];
                }
              );

            let fn2 = (proxyName) => {
              let search = searchRevisionForFlowCallouts(proxyName);
              return (p, revision) =>
                p.then((accumulator) =>
                  search(revision).then((sharedflows) =>
                    sharedflows.length
                      ? [...accumulator, { revision, sharedflows }]
                      : accumulator
                  )
                );
            };

            let fn1 = (p, nameAndRevisions) =>
              p.then((acc) =>
                nameAndRevisions.revision
                  .reduce(fn2(nameAndRevisions.name), Promise.resolve([]))
                  .then((found) =>
                    found.length
                      ? [
                          ...acc,
                          {
                            proxyname: nameAndRevisions.name,
                            found
                          }
                        ]
                      : acc
                  )
              );

            //common.logWrite(JSON.stringify(proxiesAndRevisions, null, 2));
            return proxiesAndRevisions.reduce(fn1, Promise.resolve([]));
          });
      });
  })

  .then((r) => {
    if (typeof r == "string") {
      common.logWrite(r);
    } else {
      console.log("Proxy use of sharedflows:");
      console.log(JSON.stringify(r, null, 2));

      // transform the graph
      const sf = {};
      r.forEach((proxy) => {
        proxy.found.forEach((rev) => {
          rev.sharedflows.forEach((sharedflowname) => {
            if (!sf[sharedflowname]) {
              sf[sharedflowname] = [];
            }
            sf[sharedflowname].push({
              proxyname: proxy.proxyname,
              revision: rev.revision
            });
          });
        });
      });

      console.log("Sharedflow use by Proxies:");
      console.log(JSON.stringify(sf, null, 2));
    }
  })

  .catch((e) => {
    common.logWrite("while executing, error: " + util.format(e));
  });
