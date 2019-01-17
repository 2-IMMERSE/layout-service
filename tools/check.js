/** Copyright 2018 Cisco and/or its affiliates

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
const path = require('path');
const express = require('express');
const osprey = require('osprey');
const parser = require('raml-1-parser');
const ContextController_1 = require("../dist/controllers/ContextController");
const DeviceController_1 = require("../dist/controllers/DeviceController");
const RegionController_1 = require("../dist/controllers/RegionController");
const DMAppController_1 = require("../dist/controllers/DMAppController");
const ComponentController_1 = require("../dist/controllers/ComponentController");
const ConstraintController_1 = require("../dist/controllers/ConstraintController");

let ramlPath = path.resolve(__dirname, "../api", "layout-service.raml");
let app = express();
let router = osprey.Router();
let expectedRoutes = new Map();
let extraRoutes = new Map();

// setup all our routes
ContextController_1.ContextController.register(router);
DeviceController_1.DeviceController.register(router);
RegionController_1.RegionController.register(router);
DMAppController_1.DMAppController.register(router);
ComponentController_1.ComponentController.register(router);
ConstraintController_1.ConstraintController.register(router);

let getPaths = (resources) => {
  resources.forEach(resource => {
    let methods = {};
    resource.methods.forEach(method => {
      methods[method.method] = false;
    });

    expectedRoutes.set(resource.absoluteUri, methods);

    if (resource.resources && resource.resources.length > 0) {
      getPaths(resource.resources);
    }
  });
}

console.log("Loading raml...");
parser.loadRAML(ramlPath, { rejectOnErrors: true }).then(api => {
  console.log("Expanding raml...");
  let raml = api.expand(true).toJSON({
    serializeMetadata: false
  });

  getPaths(raml.resources);

  console.log("Loading router...");
  osprey.loadFile(ramlPath).then(middleware => {
    console.log("Configuring router...");
    app.use('/', middleware, router);

    router.stack.forEach(layer => {
      console.log(layer.path);
      if (expectedRoutes.has(layer.path)) {
        let methods = expectedRoutes.get(layer.route.path);

        for (var method in layer.route.methods) {
          if (methods.hasOwnProperty(method)) {
            delete methods[method];
          } else {
            methods[method] = true;
          }
        }

        if (Object.keys(methods).length == 0) {
          expectedRoutes.delete(layer.path);
        } else {
          expectedRoutes.set(layer.path, methods);
        }
      } else {
        extraRoutes.set(layer.path, layer.route.methods);
      }
    });

    console.log("Found %d routes not implemented:", expectedRoutes.size);
    console.log(expectedRoutes);
    console.log("Found %d extra routes:", extraRoutes.size);
    console.log(extraRoutes);
  });
});
