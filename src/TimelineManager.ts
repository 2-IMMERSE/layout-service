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
import * as log4js from "log4js";
import * as request from "request-promise";
import { URL } from "url";
import { ConsulClient } from "./ConsulClient";
import { Logger } from "./Logger";
import { DMApp } from "./model/DMApp";

/**
 * interface with the timeline service if it is running with the layout
 */

export class TimelineManager {
  private logr: log4js.Logger;
  private layoutService: string;
  private consul: ConsulClient;

  /**
   * constructor
   * @param layoutPath
   * @param timelineService
   */
  constructor(private layoutPath: string, private timelineService?: string) {
    this.logr = log4js.getLogger("timeline");

    if (process.env.hasOwnProperty("MARATHON_APP_ID")) {
      const self = process.env.MARATHON_APP_ID.split("/").filter(Boolean).reverse().join("-");

      const addr = new URL("http://" + self + ".service.consul");
      addr.port = process.env.PORT0;
      addr.pathname = this.layoutPath;
      this.layoutService = addr.toString();
    }
  }

  /**
   * set consul client to be used to locate the timeline service
   * @param client
   */
  public setConsul(client: ConsulClient): void {
    this.consul = client;
  }

  /**
   * @return timelineService
   * @param dmapp
   */
  public createTimeline(dmapp: DMApp): Promise<{}> {
    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping create", {
        contextId: dmapp.contextId,
        DMAppID: dmapp._id,
      }));

      return Promise.resolve({});
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr + "/context?contextId=" + dmapp.contextId +
          "&layoutServiceUrl=" + encodeURIComponent(this.layoutService),
          method: "POST",
          json: true,
        };

        this.logr.debug(Logger.formatMessage("create", opts));

        return request(opts);
      });
  }

  /**
   * delete a context from the timeline
   * @param dmapp
   */
  public destroyTimeline(dmapp: DMApp): Promise<any> {
    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping destroy", {
        contextId: dmapp.contextId,
        DMAppId: dmapp._id,
      }));

      return Promise.resolve();
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr + "/context/" + dmapp.contextId,
          method: "DELETE",
        };

        this.logr.debug(Logger.formatMessage("destroy", opts));

        return request(opts);
      });
  }

  /**
   * post the dmapp definition to the timeline service if one is running
   * @param dmapp
   */
  public loadDMAppTimeline(dmapp: DMApp): Promise<void> {
    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping load", {
        contextId: dmapp.contextId,
        DMAppID: dmapp._id,
      }));

      return Promise.resolve();
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr.toString() + "/context/" + dmapp.contextId + "/loadDMAppTimeline?" +
          "timelineDocUrl=" + encodeURIComponent(dmapp.spec.timelineDocUrl) +
          "&dmappId=" + dmapp._id,
          method: "PUT",
          json: true,
        };

        this.logr.debug(Logger.formatMessage("load DMApp", opts));

        return request(opts)
          .catch((err) => {
            const error = {
              dmappId: dmapp._id,
              status: "error",
              message: err.message,
            };

            this.logr.error(Logger.formatMessage("Error sending loading dmapp into timeline", error));
          });
      });
  }

  /**
   * inform timeline service (if available) of dmapp deletion
   * @param dmapp
   */
  public unloadDMAppTimeline(dmapp: DMApp): Promise<any> {
    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping unload", {
        contextId: dmapp.contextId,
        DMAppID: dmapp._id,
      }));

      return Promise.resolve();
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr + "/context/" + dmapp.contextId + "/unloadDMAppTimeline?" +
          "dmappId=" + dmapp._id,
          method: "PUT",
        };

        this.logr.debug(Logger.formatMessage("unloadDMAppTimeline", opts));

        return request(opts);
      });
  }

  /**
   * send timeline service a component status (inited, started, stopped or destroyed) change
   * @param dmapp
   * @param componentId
   * @param body
   * @param fromLayout
   */
  public dmappcStatus(dmapp: DMApp, componentId: string, body: any, fromLayout: boolean = true): Promise<any> {
    const timelineBody = Object.assign(body, {
      dmappId: dmapp._id,
      componentId,
      fromLayout,
    });

    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping status", {
        url: "/context/" + dmapp.contextId + "/dmappcStatus?dmappId=" + dmapp._id
          + "&componentId=" + componentId + "&status=" + body.status,
        contextId: dmapp.contextId,
        DMAppID: dmapp._id,
        component: componentId,
        body: JSON.stringify(timelineBody),
      }));

      return Promise.resolve();
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr + "/context/" + dmapp.contextId + "/dmappcStatus?dmappId=" + dmapp._id
          + "&componentId=" + componentId + "&status=" + body.status,
          method: "PUT",
          json: true,
          body: timelineBody,
        };

        this.logr.debug(Logger.formatMessage("dmappcStatus", {
          url: opts.url,
          method: opts.method,
          body: JSON.stringify(timelineBody),
        }));

        return request(opts)
          .catch((err) => {
            const error = {
              contextId: dmapp.contextId,
              dmappId: dmapp._id,
              componentId,
              status: "error",
              message: err.message,
              body: JSON.stringify(timelineBody),
            };

            this.logr.error(Logger.formatMessage("Error sending component status to timeline", error));
          });
      });
  }

  /**
   * send timeline service  (if available) batch set of component status updates
   * @param dmapp
   * @param body
   */
  public dmappcBatchStatus(dmapp: DMApp, body: any): Promise<any> {

    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping status", {
        url: "/context/" + dmapp.contextId + "/multiStatus",
        contextId: dmapp.contextId,
        DMAppID: dmapp._id,
        body: JSON.stringify(body),
      }));

      return Promise.resolve();
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr + "/context/" + dmapp.contextId + "/multiStatus",
          method: "POST",
          json: true,
          body,
        };

        this.logr.debug(Logger.formatMessage("dmappcBatchStatus", {
          url: opts.url,
          method: opts.method,
          body: JSON.stringify(body),
        }));

        return request(opts)
          .catch((err) => {
            const error = {
              contextId: dmapp.contextId,
              dmappId: dmapp._id,
              status: "error",
              message: err.message,
              body: JSON.stringify(body),
            };

            this.logr.error(Logger.formatMessage("Error sending batch component status to timeline", error));
          });
      });
  }

  /**
   * trigger a timeline event
   * @param dmapp
   * @param eventId
   */
  public dmappcTimelineEvent(dmapp: DMApp, eventId: string): Promise<any> {
    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping event", {
        DMAppID: dmapp._id,
        eventId,
      }));

      return Promise.resolve();
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr + "/context/" + dmapp.contextId + "/timelineEvent?eventId=" + eventId,
          method: "PUT",
        };

        this.logr.debug(Logger.formatMessage("dmappcTimelineEvent", opts));

        return request(opts);
      });
  }

  /**
   * inform timeline service of clock changed event
   * @param dmapp
   * @param body
   */
  public clockChanged(dmapp: DMApp, body: any): Promise<any> {
    if (!this.timelineService || !this.consul) {
      this.logr.warn(Logger.formatMessage("empty timelineServiceUrl; skipping clockChanged", {
        DMAppId: dmapp._id,
        body,
      }));

      return Promise.resolve();
    }

    return this.discoverTimeline()
      .then((addr) => {
        const opts = {
          url: addr + "/context/" + dmapp.contextId + "/clockChanged",
          method: "PUT",
          json: true,
          body,
        };

        this.logr.debug(Logger.formatMessage("clockChanged", opts));

        return request(opts);
      });
  }

  /**
   * locate the running timeline service
   */
  private discoverTimeline(): Promise<string> {
    return this.consul.lookupService(this.timelineService).then((service) => {
      const addr = new URL("http://" + this.timelineService + ".service.consul");
      addr.port = service.ServicePort.toString();
      addr.pathname = "/timeline/v1";

      return addr.toString();
    });
  }
}
