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
import * as Promise from "bluebird";
import * as jsonschema from "jsonschema";
import * as log4js from "log4js";
import * as request from "request-promise";
import { Globals} from "../globals";
import { Logger } from "../Logger";
import { DMApp } from "../model/DMApp";
import { Util } from "../Util";

const SCHEMA = require("../../api/v4-document-schema.json"); //tslint:disable-line

/**
 * layout loader
 * loads a dmapp constraint document used by the layout engine
 * this contains all the layout rules
 */

export class LayoutLoader {
  private logr: log4js.Logger;

  constructor(private dmapp: DMApp) {
    this.logr = log4js.getLogger("dmapp");
  }

  /**
   * load a dmapp constraint document, store it in db
   */
  public loadLayout(): any {
    const opts = {
      url: this.dmapp.spec.layoutReqsUrl,
      json: true,
    };

    return request(opts).then((doc) => {
      const v = new jsonschema.Validator();
      const res = v.validate(doc, SCHEMA);

      if (res.errors.length > 0) {
        const err = new Error("layout doc schema validation error '" + JSON.stringify(res.errors) + "'");

        this.logr.error(Logger.formatMessage(err.message));

        return Promise.reject(err);
      }

      // we should modify our dmapp here?
      this.dmapp.layoutModel = doc.layoutModel;
      this.dmapp.constraints = doc.constraints || [];
      this.dmapp.templates = doc.templates || [];

      let defaultExists = false;

      this.dmapp.constraints.forEach((constraint) => {
        if (constraint.constraintId === "default") {
          defaultExists = true;
          return;
        }
      });

      if (!defaultExists) {
        this.dmapp.constraints.unshift({
          constraintId: Globals.defaultConstraintId,
          personal: Util.clone(Globals.defaultComponentConstraint),
          communal: Util.clone(Globals.defaultComponentConstraint),
        });
      }

      return Promise.resolve(this.dmapp);
    });
  }
}
