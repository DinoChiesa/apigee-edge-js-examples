#! /usr/local/bin/node
/*jslint node:true, esversion:9 */
// scanProxiesForPolicytype.js
// ------------------------------------------------------------------
// In Apigee, find all proxies that have a policy of a given type.
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
// last saved: <2023-October-19 11:46:46>

const apigeejs = require("apigee-edge-js"),
  sprintf = require("sprintf-js").sprintf,
  common = apigeejs.utility,
  apigee = apigeejs.apigee,
  tmp = require("tmp-promise"),
  fs = require("fs"),
  path = require("path"),
  AdmZip = require("adm-zip"),
  Dom = require("@xmldom/xmldom").DOMParser,
  Getopt = require("node-getopt"),
  util = require("util"),
  version = "20231019-0951",
  getopt = new Getopt(
    common.commonOptions.concat([
      [
        "",
        "policytype=ARG",
        "Required. Find proxies that use a specific type of policy."
      ],
      [
        "",
        "proxyregexp=ARG",
        "Optional. check only for proxies with names that match this regexp."
      ],
      [
        "",
        "filter=ARG",
        "Optional. filter the set of proxies. valid values: (deployed, deployed:envname, latest)."
      ]
    ])
  ).bindHelp();

let opt;

const isFilterLatestRevision = () => opt.options.filter == "latest";
const isFilterDeployed = () => opt.options.filter == "deployed";
const isFilterDeployedEnv = () =>
  opt.options.filter &&
  opt.options.filter.startsWith("deployed:") &&
  opt.options.filter.slice(9);

const getKeeperPredicate = (opt) =>
  opt.options.proxyregexp
    ? (name) => name.match(new RegExp(opt.options.proxyregexp))
    : () => true;

const toRevisions = (org) => (promise, name) =>
  promise.then((accumulator) => {
    if (isFilterDeployedEnv() || isFilterDeployed()) {
      const environment = isFilterDeployedEnv();
      return org.proxies
        .getDeployments({ name, environment })
        .then((response) => {
          if (response.deployments) {
            // GAAMBO
            const deployments = response.deployments.map((d) => ({
              name,
              revision: [d.revision],
              environment: d.environment
            }));
            return [...accumulator, ...deployments];
          }
          if (response.revision) {
            // Admin API
            const deployments = response.revision.map((r) => ({
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
// process.argv array starts with 'node' and 'scriptname.js'
opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee policy finder tool, version: ${version}\n` +
      `Node.js ${process.version}\n`
  );

  common.logWrite("start");
}

if (!opt.options.policytype) {
  console.log("you must specify --policytype, eg ServiceCallout or HMAC, etc");
  process.exit(1);
}

common.verifyCommonRequiredParameters(opt.options, getopt);
apigee
  .connect(common.optToOptions(opt))
  .then((org) =>
    tmp
      .dir({ unsafeCleanup: true, prefix: "findPolicyByType" })
      .then(async (tmpdir) => {
        let result = await org.proxies.get();
        /**
         * Starting from the list of proxies, filter to keep only those of
         * interest, then get the revisions of each one (maybe confining the
         * check to only the most recent revision), and then examine the
         * policies or resources in those revisions.
         **/

        // for GAAMBO
        let proxies = opt.options.apigeex
          ? result.proxies.map((p) => p.name)
          : result;
        if (opt.options.regexp) {
          const re1 = new RegExp(opt.options.regexp);
          proxies = proxies.filter((item) => re1.test(item));
        }
        if (!proxies || proxies.length == 0) {
          common.logWrite(
            "No %sproxies",
            opt.options.regexp ? "matching " : ""
          );
          return Promise.resolve(true);
        }
        const proxiesAndRevisions = await proxies
          .sort()
          .filter(getKeeperPredicate(opt))
          .reduce(toRevisions(org), Promise.resolve([]));

        if (opt.options.verbose) {
          common.logWrite(
            "checking..." + JSON.stringify(proxiesAndRevisions, null, 2)
          );
        }

        function exportOneProxyRevision(name, revision) {
          return org.proxies
            .export({ name: name, revision: revision })
            .then((result) => {
              let pathOfZip = path.join(tmpdir.path, result.filename);
              fs.writeFileSync(pathOfZip, result.buffer);
              if (opt.options.verbose) {
                common.logWrite("export ok: %s", pathOfZip);
              }
              return pathOfZip;
            });
        }

        function unzipRevision(name, revision) {
          return exportOneProxyRevision(name, revision).then((pathOfZip) => {
            let zip = new AdmZip(pathOfZip);
            let pathOfUnzippedBundle = path.join(
              tmpdir.path,
              `proxy-${name}-r${revision}`
            );
            zip.extractAllTo(pathOfUnzippedBundle, false);
            if (opt.options.verbose) {
              common.logWrite("unzipped to: %s", pathOfUnzippedBundle);
            }
            return pathOfUnzippedBundle;
          });
        }

        function checkRevision(proxyName) {
          return (revision) =>
            unzipRevision(proxyName, revision).then((pathOfUnzippedBundle) => {
              const policiesDir = path.join(
                pathOfUnzippedBundle,
                "apiproxy",
                "policies"
              );
              if (!fs.existsSync(policiesDir)) {
                common.logWrite(
                  `found no policy files for: ${proxyName} r${revision}`
                );
                return [];
              }
              const result = fs.readdirSync(policiesDir).filter((name) => {
                const fname = path.join(policiesDir, name);
                if (fname.endsWith(".xml")) {
                  const element = new Dom().parseFromString(
                    fs.readFileSync(fname, "utf-8")
                  );

                  if (opt.options.verbose) {
                    common.logWrite(
                      `file ${fname}: check ${element.documentElement.tagName} ?=? ${opt.options.policytype}`
                    );
                  }
                  return (
                    element.documentElement.tagName == opt.options.policytype
                  );
                }
              });
              return result;
            });
        }

        const fn2 = (proxyName) => {
          const check = checkRevision(proxyName);
          return (p, revision) =>
            p.then((accumulator) =>
              check(revision).then((result) => [
                ...accumulator,
                { revision, policies: result }
              ])
            );
        };

        const fn1 = (p, nameAndRevisions) =>
          p.then((acc) =>
            nameAndRevisions.revision
              .reduce(fn2(nameAndRevisions.name), Promise.resolve([]))
              .then((a) => [
                ...acc,
                { proxyname: nameAndRevisions.name, found: a }
              ])
          );

        return proxiesAndRevisions.reduce(fn1, Promise.resolve([]));
      })
  )

  .then((r) => {
    r = r.filter((entry) =>
      entry.found.find((item) => item.policies.length != 0)
    );
    console.log("" + JSON.stringify(r, null, 2));
  })

  .catch((e) => console.log("while executing, error: " + e + "\n" + e.stack));
