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
import { IComponentConstraint } from "../model/Component";
import { Context } from "../model/Context";
import { DMApp } from "../model/DMApp";

export class Transaction {
  public static STARTED: string = "started";
  public static INITIALIZED: string = "inited";
  public static STOPPED: string = "stopped";
  public static DESTROYED: string = "destroyed";
  public static UPDATED: string = "updated";
  public static DESTROYABLE: string = "destroyable";

  public requiresRebuild: boolean = false;
  public context: Context;
  public dmapp: DMApp;

  private initList: any[];
  private updateList: any[];
  private startList: string[];
  private stopList: string[];
  private destroyList: string[];

  constructor(private time: number) {
    this.initList = [];
    this.startList = [];
    this.stopList = [];
    this.destroyList = [];
    this.updateList = [];
  }

  public setDMApp(dmapp: DMApp) {
    this.dmapp = dmapp;
  }

  public setContext(context: Context) {
    this.context = context;
  }

  public init(cc: IComponentConstraint, config: any, params: any) {
    this.initList.push({
      cc,
      config,
      params,
    });
  }

  public start(cc: IComponentConstraint) {
    this.startList.push(cc.componentId);
  }

  public update(cc: IComponentConstraint, params: any) {
    this.updateList.push({
      cc,
      params,
    });
  }

  public stop(cc: IComponentConstraint) {
    this.stopList.push(cc.componentId);
  }

  public destroy(cc: IComponentConstraint) {
    this.destroyList.push(cc.componentId);
  }

  public commit(): Promise<DMApp> {
    return this.startComponents()
        .then(() => this.stopComponents())
        .then(() => this.updateComponents())
        .then(() => this.destroyComponents())
        .then(() => this.dmapp.save());
  }

  public getList(which: string): string[]  {
    switch (which) {
      case Transaction.STARTED:
        return this.startList;
      case Transaction.INITIALIZED:
        return this.initList.map((init) => {
          return init.cc.componentId;
        });
      case  Transaction.STOPPED:
        return this.stopList;
      case  Transaction.DESTROYED:
        return this.destroyList;
      case  Transaction.UPDATED:
        return this.updateList.map((update) => {
          return update.cc.componentId;
        });
      case Transaction.DESTROYABLE:
        return this.destroyList.filter((x) => this.stopList.indexOf(x) < 0);
      default:
        return [];
    }
  }

  public commitInit(): Promise<DMApp>  {
    return this.initComponents()
        .then(() => this.dmapp.save());
  }

  private initComponents() {
    this.initList.forEach((init) => {
      this.dmapp.initComponent(init.cc, init.config, init.params);
    });

    return Promise.resolve();
  }

  private startComponents() {
    this.startList.forEach((id) => {
      this.dmapp.startComponent(id, this.time);
    });

    return Promise.resolve();
  }

  private updateComponents() {
    this.updateList.forEach((update) => {
      this.dmapp.updateComponent(update.cc, update.params);
    });

    return Promise.resolve();
  }

  private stopComponents() {
    this.stopList.forEach((id) => {
      this.dmapp.stopComponent(id, this.time);
    });

    return Promise.resolve();
  }

  private destroyComponents() {
    this.destroyList.forEach((id) => {
      this.dmapp.removeComponent(id);
    });
    return Promise.resolve();
  }
}
