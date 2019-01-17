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
import * as log4js from "log4js";
import * as io from "socket.io-client";
import { Logger } from "./Logger";
import { Util } from "./Util";

/**
 * used to send messages to other services over the websocket server
 */

export class SocketClient {
  private socket: io.Socket;
  private logr: log4js.Logger;

  constructor() {
    this.logr = log4js.getLogger("ws");
  }

  /**
   * connet to the websocker server
   * @param url
   */
  public connect(url: string): Promise<{}> {
    return new Promise((resolve, reject) => {
      this.logr.debug(Logger.formatMessage("Initialising socket " + url + "..."));
      this.socket = io.connect(url, {
        timeout: 2000,
      });

      this.socket.on("EVENT", (data) => {
        this.logr.debug(Logger.formatMessage("received EVENT: " + JSON.stringify(data)));
      });

      this.socket.on("CLIENTS", (data) => {
        this.logr.debug(Logger.formatMessage("received CLIENTS: " + JSON.stringify(data)));
      });

      this.socket.on("disconnect", () => {
        this.logr.debug(Logger.formatMessage("disconnected!"));
        process.exit(1);
      });

      this.socket.on("error", (err) => {
        this.logr.error(Logger.formatMessage("error!", err));
        reject();
      });

      this.socket.on("connect", () => {
        this.logr.debug(Logger.formatMessage("Socket connected"));
        resolve();
      });
    });
  }

  public alive(): boolean {
    if (!this.socket) {
      return true;
    }

    return this.socket.connected;
  }

  /**
   * push a message out to the websocket service
   * note: the msg parameter cannot be a string because JSON(stringify (JSON(stringify (data)))
   * includes quotes as part of the data
   * so that the receiving side parses it incorrectly
   * @param contextId
   * @param id
   * @param msg
   */
  public pushNotice(contextId: string, id: string, msg: object): void {
    if (!this.socket) {
      // skip if socket not setup
      return;
    }

    const data = {
      room: Util.roomId(contextId, id),
      sender: "layoutServer",
      message: msg,
    };

    this.logr.debug(Logger.formatMessage("sending notification: " + JSON.stringify(data), { contextID: contextId }));
    this.socket.emit("NOTIFY", JSON.stringify(data));
  }

  /**
   * join a room to listen for messages
   * @param contextId
   * @param id
   * @param name
   */
  public joinRoom(contextId: string, id: string, name: string): void {
    if (!this.socket) {
      // skip if socket not setup
      return;
    }

    const data = {
      room: Util.roomId(contextId, id),
      name: "layout_" + name,
    };

    this.logr.debug(Logger.formatMessage("joining room: " + JSON.stringify(data)));
    this.socket.emit("JOIN", JSON.stringify(data));
  }

  /**
   * leave a message room
   * @param contextId
   * @param id
   * @param name
   */

  public leaveRoom(contextId: string, id: string, name: string): void {
    if (!this.socket) {
      // skip if socket not setup
      return;
    }

    const data = {
      room: Util.roomId(contextId, id),
      name: "layout_" + name,
    };

    this.logr.debug(Logger.formatMessage("leaving room: " + JSON.stringify(data)));
    this.socket.emit("LEAVE", JSON.stringify(data));
  }

  public shutdown() {
    if (this.socket) {
      this.logr.info(Logger.formatMessage("Shutting down WebSocket..."));
      this.socket.disconnect();
      this.socket.close();
    }
  }
}
