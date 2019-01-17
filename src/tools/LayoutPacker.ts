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
import * as _ from "underscore";
import { isNullOrUndefined } from "util";
import { Globals} from "../globals";
import { Logger } from "../Logger";
import { Util} from "../Util";
import {
  BBox, ILayoutConstraint, Node, PackerNode, PackerRectangle, PackerRegion, PackerUtils, Packing, PackingSize, Pruner,
} from "./PackerUtils";

class SplitOption {
  public node: Node;
  public split: string;
}

/**
 * packing algorithm used to lay out the components (rectangles) over a set of regions
 * where the regions are backed by underlying physical devices.
 * The input to the packer algorithm includes
 *    - a list of rectangular regions (i.e., logical rectangular display areas, mapped onto underlying physical devices),
 *    - their associated device information, and
 *    - a list of rectangular components and associated constraints to be packed.
 * The output is a list of components per device, with region, position and size for each placed component
 * where all coordinates are relative to the top left corner which is at (0,0).
 * The algorithm is multi-pass; since the primary application is for digital media applications,
 * the number of components and displays is small,
 * thus efficiency is not a prime consideration, rather, generating optimal and aesthetic layouts.
 *
 * Pass One begins by sorting the regions in decreasing size order and sorting the components in decreasing priority
 * order using size as a secondary sort constraint.
 * The component sizes are not fixed, thus the packing engine computes a first approximation to the number of components
 * that will fit into the given region set,
 * and then sorts the highest priority components that will fit, in decreasing size order.
 * The destination regions are stored in a list of nodes, initialized with one node per region, all marked as unoccupied.
 * When the packer places a component into a region, and the incoming component does not utilize an entire dimension
 * (e.g. due to aspect ratio or maximum size constraints)
 * the node will be split into two or three regions rather than two, as seen in Fig. 1.
 * If the packer does not find an unoccupied appropriate node for the component, it attempts to split and occupied node
 * and populate the second half with the new component.
 * The packer uses the preferred size, minimum size, anchor, and aspect ratio constraints to determine how to fit the components.
 *
 * Pass Two attempts to fit in any unplaced components in the first pass due to lack of space: if not all components were laid out,
 * the packer will successively reduce the size of all the components using a decreasing reduction factor.
 * The packer then chooses the layout that fits the highest number of components, and if all are equal,
 * chooses that with the least white space.
 *
 * Pass Three re-arranges the layout so that is more aesthetic, i.e., avoids holes in the center of the displays,
 * minimizes white space and collates white space to the right and bottom of the rectangle.
 * The packer sorts the resultant nodes in position order, starting at the top left and moving right then down,
 * and packs the components again using the internal packer loop,
 * choosing the layout that maximizes real estate coverage as well as the number of placed components.
 *
 * Results
 * The packing algorithm always adheres to the defined constraints, provides a good distribution of the components over the regions,
 * and generates aesthetic layouts particularly when constraints do not include maximum sizes.
 */

export class LayoutPacker {
  public _beautify: boolean = true;
  private _beautifyPrefsize: boolean = false;
  private alternateRegions: boolean = true;

  private logr: log4js.Logger;
  private reduceFactor: number = Globals.packer.ReductionRate;
  private reduceIterations: number = Globals.packer.MaxIterations;
  private singleReductionRate: number =  Globals.packer.SingleReductionRate;

  private _updates: Node[] = [];
  private _device: boolean = false;
  private _nodes: Node[] = [];
  private _dropped: Node[] = [];
  private _numVideoComponentsPlaced = {}; // per device
  private _numAudioComponentsPlaced = {}; // per device

  private _isMixed = false;

  private _shuffling: boolean = false;
  private _pass: number = 1;
  private _lastChance: number = 20;

  constructor(private verbose: boolean = false) {
    this.logr = log4js.getLogger("packer");
  }

  /* ======================================================
   * algorithm parameters
   */
  public resetReductionRate(): void  {
    this.reduceFactor = Globals.packer.ReductionRate;
  }

  public resetReductionIterations(): void {
    this.reduceIterations = Globals.packer.MaxIterations;
  }

  public resetSingleReductionRate(): void {
    this.singleReductionRate = Globals.packer.SingleReductionRate;
  }

  public setReductionRate(reducerate: number): void {
    this.reduceFactor = reducerate;
  }

  public setReductionIterations(iterations: number): void {
    this.reduceIterations = iterations;
  }

  public setSingleReductionRate(iterations: number): void {
    this.singleReductionRate = iterations;
  }

  public setBeautify(beautify: boolean): void {
    this._beautify = beautify;
  }

  /* ======================================================
   * run the packing algorithm
   */

  /**
   * pack list of rects onto a single region
   * @return packing result
   * @param region
   * @param rects
   * @param isMixed
   */
  public packRegion(region: PackerRegion, rects: PackerRectangle[], isMixed: boolean = false): Packing {
    return this._pack([region], rects, isMixed);
  }

  /**
   * @return packing of specified rects onto the list of given regions
   * @param regions
   * @param rects
   * @param isMixed
   */
  public packRegions(regions: PackerRegion[], rects: PackerRectangle[], isMixed: boolean = false): Packing {
    return this._pack(regions, rects, isMixed);
  }

  /**
   * the packer algorithm driver
   * @return the rectangles packed into the packing regions
   * @param packingregions
   * @param rectangles
   * @param isMixed
   * @private
   */
  private _pack(packingregions: PackerRegion[], rectangles: PackerRectangle[], isMixed: boolean = false): Packing {
    const packed: Packing = {
      layout:    [],
      notPlaced: [],
      noDevice:  [],
    };

    this._isMixed = isMixed;

    /* nothing much to do */
    if (packingregions.length < 1 || rectangles.length < 1) {
      return packed;
    }

    /* pre-process rectangles */
    const initializedRects: PackerRectangle[] = this.init (rectangles);
    let rects: PackerRectangle[] = Util.clone(initializedRects);
    rects = PackerUtils.sortRects (rects, packingregions, false);
    packed.notPlaced = _.difference (_.pluck (rectangles, "componentId"), _.pluck (rects, "componentId"));
    this.logr.debug(Logger.formatMessage("====> pass 0, rect order is: " + _.pluck (rects, "componentId")));

    /* pass one: pack as much as possible */
    const reduceFactor = this.reduceFactor;
    this.reduceFactor = this.singleReductionRate;
    this._pass = 1;

    const trees = PackerUtils.buildtreelist(packingregions);
    let packerPass: Packing = this.packer (trees, rects, 1.0);

    /* pass two: reduce component sizes and try to repack more, using min sizes where possible */
    this.reduceFactor = reduceFactor;
    this._pass = 2;
    let reduction = 1.0;

    if (packerPass.notPlaced.length > 0) {
      let iteration = 1;
      let passTwo: Packing = Util.clone(packerPass);
      let bestAttempt: Packing = Util.clone(packerPass);
      while (iteration <= this.reduceIterations) {
        /* reset trees who have non-placed components */
        const regions = PackerUtils.regionsToRebuild (passTwo.notPlaced, packingregions);
        if (_.isEmpty(regions)) {
          break;
        }

        const nextAttempt = this.attemptTwo (passTwo, regions, Util.clone(initializedRects), reduction);

        if (nextAttempt.notPlaced.length < bestAttempt.notPlaced.length) {
          bestAttempt = Util.clone(nextAttempt);
        }
        if (nextAttempt.notPlaced.length === 0) {
          break;
        }
        passTwo = nextAttempt;
        iteration ++;
        reduction *= this.reduceFactor;
      }
      if (bestAttempt.notPlaced.length < packerPass.notPlaced.length) {
         packerPass = bestAttempt;
      }
    }

    /* using just the rects that fit, try to cover more space */
    let ws = PackerUtils.computeWhiteSpace(packerPass.rects, packingregions);
    if (ws > 0) {
      const nodes = Util.clone (this._nodes);
      const notplaced = Util.clone (packerPass.notPlaced);
      const nodevice = Util.clone(packerPass.noDevice);
      const nodependent = Util.clone(packerPass.noDependent);
      this._pass = 3;
      /* don't redo regions with preferred size components */
      const pruner: Pruner = PackerUtils.prunePrefRegions ({
        trees: PackerUtils.buildtreelist(packingregions),
        rects: Util.clone (packerPass.rects),
        prunedTrees: [],
        prunedRects: [],
      }, !this._beautifyPrefsize);
      if (pruner.trees.length > 0 && pruner.rects.length > 1) {
        this._nodes = [];
        pruner.rects.forEach((rect) => this.__clearLayout(rect));
        pruner.rects = pruner.rects.sort((a, b) => {
          return PackerUtils.largerDimArea(PackerUtils.toPixelResolution(a.constraints.minSize),
                                            PackerUtils.toPixelResolution(b.constraints.minSize));
        });
        const newPass: Packing = this._packer_pass(pruner.trees, pruner.rects, 1.0, true);
        newPass.rects = newPass.rects.concat(pruner.prunedRects);
        this._nodes = this._nodes.concat(pruner.prunedTrees);
        const fill1 = PackerUtils.computeFillSpace(packerPass.rects);
        const fill2 = PackerUtils.computeFillSpace(newPass.rects);
        if (newPass.rects.length > packerPass.rects.length || (fill2 >= fill1 && newPass.rects.length === packerPass.rects.length)) {
          packerPass = newPass;
          packerPass.notPlaced = newPass.notPlaced.concat(notplaced);
          packerPass.noDependent = newPass.notPlaced.concat(nodependent);
          packerPass.noDevice = newPass.notPlaced.concat(nodevice);
          ws = PackerUtils.computeWhiteSpace(newPass.rects, packingregions);
        } else {
          this._nodes = nodes;
        }
      }
    }

    /* shuffle the rects into the cut nodes */
    if (this._beautify && (ws > 0) ) {
      packerPass = this.__beautify (packerPass, reduction);
    }

    // if (this.verbose) {
    //   PackerUtils.printLayout(this.logr, packerPass);
    // }

    packed.layout = packerPass.rects;
    packed.notPlaced = _.union(packed.notPlaced, _.pluck(_.union (packerPass.notPlaced, packerPass.noDependent), "componentId"));
    packed.noDevice = _.pluck(packerPass.noDevice, "componentId");
    return packed;
  }

  /**
   * initialize rectangle data to contain default values
   * @return initialized list of rectangles (representing components) to be packed
   * @param rects
   */
  private init(rects: PackerRectangle[]): PackerRectangle[] {
    rects.forEach ((rect) => {
      const constraints = rect.constraints;

      /* mark not placed */
      rect.x0 = -1;
      rect.y0 = -1;
      if (! constraints.hasOwnProperty("prefSize")) {
        constraints.prefSize = PackerUtils.defaultPrefSize;
      } else if (! constraints.prefSize.hasOwnProperty("mode")) {
        constraints.prefSize.mode = "px";
      } else if (constraints.prefSize.hasOwnProperty("mode") && constraints.prefSize.mode === "inches") {
        constraints.prefSize.widthInches = constraints.prefSize.width;
        constraints.prefSize.heightInches = constraints.prefSize.height;
        constraints.marginInches = constraints.margin;
      }

      /* try to provide what was requested */
      const size = PackerUtils.rectSize (constraints);
      rect.width = constraints.prefSize.width === -1 ? -1 : size.width;
      rect.height = constraints.prefSize.height === -1 ? -1 : size.height;

      /* defaults */
      if (! constraints.hasOwnProperty("aspect")) {
        constraints._aspect = PackerUtils.noAspect;
      }

      if (! constraints.hasOwnProperty("minSize")) {
        constraints.minSize = PackerUtils.minRect;
      } else if (! constraints.minSize.hasOwnProperty("mode")) {
        constraints.minSize.mode = "px";
      } else if (constraints.minSize.mode === "inches") {
        constraints.minSize.widthInches = constraints.minSize.width;
        constraints.minSize.heightInches = constraints.minSize.height;
      }

      if (rect.personalconstraints != null) {
        if (! rect.personalconstraints.hasOwnProperty("prefSize")) {
          rect.personalconstraints.prefSize = PackerUtils.defaultPrefSize;
        } else if (! rect.personalconstraints.prefSize.hasOwnProperty("mode")) {
          rect.personalconstraints.prefSize.mode = "px";
        } else if (rect.personalconstraints.prefSize.hasOwnProperty("mode") && rect.personalconstraints.prefSize.mode === "inches") {
          rect.personalconstraints.prefSize.widthInches = rect.personalconstraints.prefSize.width;
          rect.personalconstraints.prefSize.heightInches = rect.personalconstraints.prefSize.height;
          rect.personalconstraints.marginInches = rect.personalconstraints.margin;
        }
        if (! rect.personalconstraints.hasOwnProperty("minSize")) {
          rect.personalconstraints.minSize = PackerUtils.minRect;
        } else if (! rect.personalconstraints.minSize.hasOwnProperty("mode")) {
          rect.personalconstraints.minSize.mode = "px";
        } else if (rect.personalconstraints.minSize.mode === "inches") {
          rect.personalconstraints.minSize.widthInches = rect.personalconstraints.minSize.width;
          rect.personalconstraints.minSize.heightInches = rect.personalconstraints.minSize.height;
        }
      }
    });

    return rects;
  }

  /**
   * second pass attempting to pack more rectangles into regions that have non-placed rectangles.
   * don't touch fully placed regions.
   * we try making all the rectangles smaller to make more room
   * @return packing of the rectangles onto the regions
   * @param packed
   * @param regions
   * @param rectangles
   * @param reduction
   */
  private attemptTwo(packed, regions, rectangles, reduction: number): Packing {
    const trees = PackerUtils.buildtreelist(Util.clone(regions));

    let takeTwo = Util.clone(packed.notPlaced);
    const regionlist = _.pluck (regions, "regionId");
    packed.rects.forEach ((r) => {
      if (_.contains (regionlist, r.regionId) || _.contains (regionlist,  r.deviceId)) {
        takeTwo.push(r);
        packed.rects = _.reject (packed.rects, r);
      }
    });
    packed.noDependent.forEach ((r) => {
      if (_.contains (regionlist, r.regionId) || _.contains (regionlist,  r.deviceId)) {
        takeTwo.push(r);
        packed.noDependent = _.reject (packed.noDependent, r);
      }
    });
    const reclist = _.pluck(takeTwo, "componentId").map ((c) => {
      return (rectangles.find ((rect) => (rect.componentId === c)));
    });
    reclist.forEach ((rect) => {
      const size = PackerUtils.rectSize(rect.constraints, trees[0].rect);
      rect.width = size.width;
      rect.height = size.height;
    });
    takeTwo = PackerUtils.prioritizeRects (reclist, trees);
    takeTwo.forEach((rect) => this.__clearLayout(rect));

    if (this.verbose) {
      this.logr.debug(Logger.formatMessage("====>  rect order is: " + _.pluck (reclist, "componentId")));
    }
    packed.notPlaced = [];
    const pruned = _.difference (_.pluck (takeTwo, "componentId"), _.pluck (reclist, "componentId"));

    /* try with smaller sizes */
    const newpacked = this.packer(trees, takeTwo, reduction);

    packed.rects = _.union (packed.rects, newpacked.rects);
    packed.notPlaced = _.union(newpacked.notPlaced, pruned);
    packed.noDependent = newpacked.noDependent;

    return packed;
  }

  /*
   * --------------------------------------------------------------------------------------
   * algorithm attempts to reduce component sizes when they don't fit
   * according to reductions listed in the array
   * last attempt = min size specified by the rect
   */
  private packer(trees: PackerNode[], rects: PackerRectangle[], originalReduction): Packing {
    const doesntFit = [];
    const nodevice = [];
    const nodep = [];
    const factor = 1.0;
    const packed = [];
    let lastPlacedRegion: string = null;
    this._updates = [];

    this._nodes = trees;

    this._numAudioComponentsPlaced = {};
    this._numVideoComponentsPlaced = {};
    trees.forEach((t) => {
      this._numAudioComponentsPlaced[t.rect.deviceId] = 0;
      this._numVideoComponentsPlaced[t.rect.deviceId] = 0;
    });

    rects.forEach((r) => {
      let node = null;
      let iteration: number = 0;
      const original = Util.clone(r);
      let reduction = originalReduction;

      /* try to place it */
      if (PackerUtils.packedDependencies (r, packed)) {
        while (node == null && iteration < this.reduceIterations) {
          const currentpass = this._pass;
          if (iteration === this.reduceIterations - 1) {
            this._pass = 2;
          }
          this._device = false;
          /* packRect is destructive, save original copy in case it fails */
          const originalNodelist: Node[] = Util.clone(this._nodes);
          const originalRect: PackerRectangle = Util.clone (r);

          node = this.packRect(r, reduction, factor);

          if (node == null) {
            /* restore original to prevent needless fragmentation */
            this._nodes = originalNodelist;
            r.x0 = originalRect.x0;
            r.y0 = originalRect.y0;
            r.width = originalRect.width;
            r.height = originalRect.height;
          } else {
            /* success, remove remaining invalid nodes (they were split) */
            this._dropped.forEach ((droppednode) => this._nodes = _.reject (this._nodes, droppednode));
            this._dropped = [];
            break;
          }

          if (this._device === false) {
            /* no device matches, no point continuing */
            break;
          }

          /* see if we can split a node that has no preferred size defined */
          const options: SplitOption[] = this.findSplitNodeOptions(r, reduction);
          options.forEach((option) => {
            if (node == null) {
              node = this._nodes.find((t) => (t.id === option.node.id));
              if (node.occupiedBy != null) {
                const rConstraint = PackerUtils.resolveConstraints(node, this._isMixed, r);
                const nConstraint = PackerUtils.resolveConstraints(node, this._isMixed, node.rect);
                if (! PackerUtils.isAnchored(rConstraint) || !PackerUtils.anchoredVCenter(nConstraint)) {
                  node = this.consolidateSingleNode(node);
                }
                node = this.splitNode(node, option.split, r, reduction);
              }
            }
          });
          if (node != null) {
            node = this._nodes.find((t) => (t.id === node.id));
            break;
          }

          reduction = reduction * this.reduceFactor;
          ++iteration;
          this._pass = currentpass;
        }

        if (node == null) {
          /* couldn't place it */
          r.width = original.width;
          r.height = original.height;
          r.x0 = -1;
          r.y0 = -1;
          if (this._device) {
            doesntFit.push(r);
          } else {
            nodevice.push (r);
          }
        } else {
          const constraints = PackerUtils.resolveConstraints(node, this._isMixed, r);
          r.x0 = node.rect.x0;
          r.y0 = node.rect.y0;
          if (constraints._aspect !== 0.0 && (! Util.isEqualwithPrecision(node.rect.height / node.rect.width, constraints._aspect, 0.001))) {
            r.width = node.rect.width;
            r.height = node.rect.height;
            node = this.aspect_adjust_nofail(node, r,
                                              node.rect.width >= node.rect.height ? "width" : "height",
                                              PackerUtils.toPixelResolution(constraints.minSize, PackerUtils.minRect, node.rect));
            r.x0 = node.rect.x0;
            r.y0 = node.rect.y0;
          }
          const minsize = PackerUtils.toPixelResolution(constraints.minSize, PackerUtils.minRect, node.rect, constraints._aspect);
          if (node.rect.width < minsize.width || node.rect.height < minsize.height) {
            r.x0 = -1;
            r.y0 = -1;
            r.width = -1;
            r.height = -1;
            doesntFit.push(r);
          } else {
            r.dpi = node.rect.dpi;
            if (constraints.prefSize.mode === "inches") {
              r.margin = constraints.hasOwnProperty("marginInches") ? constraints.marginInches * r.dpi : constraints.margin * r.dpi;
              node.rect.margin = r.margin;
              r.x0 = node.rect.x0;
              r.y0 = node.rect.y0;
            }
            r.width = node.rect.width;
            r.height = node.rect.height;
            r.deviceId = node.rect.deviceId;
            r.regionId = node.rect.regionId;
            r.boundingWidth = node.rect.boundingWidth;
            r.boundingHeight = node.rect.boundingHeight;
            node.occupiedBy = r.componentId;
            this._updates.push(node);
            node.rect.constraints = Util.clone(r.constraints);
            node.rect.personalconstraints = Util.clone(r.personalconstraints);
            if (constraints.hasOwnProperty("video") && constraints.video === true) {
              this._numVideoComponentsPlaced[node.rect.deviceId] += 1;
            }
            if (constraints.hasOwnProperty("audio") && constraints.audio === true) {
              this._numAudioComponentsPlaced[node.rect.deviceId] += 1;
            }
            lastPlacedRegion = r.regionId;
            packed.push(r.componentId);
          }

          /* pack white space */
          this.consolidateWhiteNodes(lastPlacedRegion);
         }
      } else {
        nodep.push (r);
      }
    });

    this._updates.forEach ((item) => {
      PackerUtils.updateRect (item, rects);
    });
    doesntFit.forEach((r) => {
      rects = _.reject (rects, r);
    });
    nodevice.forEach((r) => {
      rects = _.reject (rects, r);
    });
    nodep.forEach ((r) => {
      rects = _.reject (rects, r);
    });

    return {
      rects,
      notPlaced: doesntFit,
      noDevice: nodevice,
      noDependent: nodep,
      tree: this._nodes,
    };
  }

  /* --------------------------------------------------------------------------------------------------------------------------
   */
  /**
   * find a node from this.nodes that will fit the specified rectangle
   * @return the node that will hold the rectangle
   * @param rect
   * @param reduction
   * @param factor
   */
  private packRect(rect: PackerRectangle, reduction: number,  factor: number): Node {
    let done: boolean = false;
    let retNode: Node = null;
    this._dropped = [];

    while (! done) {
      done = true;
      for (const n in this._nodes) {
        const node = this._nodes[n];
        const _rectconstraints = PackerUtils.resolveConstraints(node, this._isMixed, rect);
        const anchored = _rectconstraints.hasOwnProperty("anchor");

        if (! PackerUtils.validRegion(_rectconstraints.valid, node.rect)) {
          continue;
        }
        if (_rectconstraints.hasOwnProperty("video") && _rectconstraints.video) {
          if (this._numVideoComponentsPlaced[node.rect.deviceId] >= node.rect.maxVideo) {
            continue;
          }
        }
        if (_rectconstraints.hasOwnProperty("audio") && _rectconstraints.audio) {
          if (this._numAudioComponentsPlaced[node.rect.deviceId] >= node.rect.maxAudio) {
            continue;
          }
        }

        this._device = true;

        const enclosingRect = PackerUtils.computeBounds(rect, node.rect, anchored, reduction, _rectconstraints);
        const _minSize = PackerUtils.toPixelResolution(_rectconstraints.minSize, PackerUtils.minRect, enclosingRect, _rectconstraints._aspect);

        if (_minSize.width > enclosingRect.boundingWidth || _minSize.height > enclosingRect.boundingHeight) {
          continue;
        }

        if (node.occupiedBy != null) {
          continue;
        }

        /* verify anchor constraints */
        if (anchored && ((enclosingRect.boundingX0 === 0 && node.rect.x0 > 0)
          || (enclosingRect.boundingY0 === 0 && node.rect.y0 > 0)
          || (enclosingRect.boundingX1 > 0 && node.rect.x0 + node.rect.width < enclosingRect.boundingWidth)
          || (enclosingRect.boundingY1 > 0 && node.rect.y0 + node.rect.height < enclosingRect.boundingHeight))) {
          continue;
        }

        const boundingW = node.rect.width * reduction;
        const boundingH = node.rect.height * reduction;
        const vcenter = anchored && PackerUtils.hasAnchor(_rectconstraints, "vcenter");

        /* dont split the node */
        if (_rectconstraints.prefSize.mode === "px" && !vcenter
          && ((enclosingRect.boundingX0 > -1 && enclosingRect.boundingX1 > -1)
          || (enclosingRect.boundingY0 > -1 && enclosingRect.boundingY1 > -1))) {
          return this.aspectSplit(node, rect, rect.width >= rect.height ? "width" : "height", _minSize);
        }

        /* set rectangle size
         *
         * handle special case size designations
         * string => percent of device area
         * -1 => no preference, fit it in
         */
        const margin = 2 * _rectconstraints.margin;
        let subdivide = false;
        let w = _rectconstraints.prefSize.width * reduction + margin;
        let h = _rectconstraints.prefSize.height * reduction + margin;
        // if (this._pass >= 2) {
        //   if (_minSize.width > Globals.packer.MinDimension) {
        //     w = _rectconstraints.minSize.width;
        //   }
        //   if (_minSize.height > Globals.packer.MinDimension) {
        //     w = _rectconstraints.minSize.height;
        //   }
        // }

        if (_rectconstraints.prefSize.mode === "percent") {
          w = enclosingRect.width * _rectconstraints.prefSize.width / 100.0 * reduction + margin;
          h = enclosingRect.height * (_rectconstraints.prefSize.height) / 100.0 * reduction + margin;
          if (_rectconstraints.prefSize.width === -1 && _rectconstraints.prefSize.height === -1) {
            if (node.rect.width >= node.rect.height) {
              w = ((this._pass > 1) && _minSize.width > Globals.packer.MinDimension)
                ? _minSize.width + margin
                : PackerUtils.setUndefinedLegLength(node, enclosingRect, reduction, "width", _minSize, _rectconstraints.margin);
              h = ((this._pass > 1) && _minSize.height > Globals.packer.MinDimension)
                ? (_rectconstraints._aspect === PackerUtils.noAspect
                    ? _minSize.height + margin
                    : PackerUtils.correctedSize(w, node.rect.height, _rectconstraints.margin, _rectconstraints._aspect, boundingW, boundingH).height)
                : node.rect.height;
            } else {
              w = node.rect.width;
              h = PackerUtils.setUndefinedLegLength(node, enclosingRect, reduction, "height", _minSize, _rectconstraints.margin);
            }
          } else {
            if (_rectconstraints.prefSize.width === -1) {
              if (_rectconstraints._aspect !== PackerUtils.noAspect) {
                w = (h - margin) / _rectconstraints._aspect;
              } else {
                w = ((this._pass >= 2) && _minSize.width > Globals.packer.MinDimension)
                  ? _minSize.width + margin
                  : PackerUtils.setUndefinedLegLength(node, enclosingRect, reduction, "width", _minSize, _rectconstraints.margin);
              }
            }
            if (_rectconstraints.prefSize.height === -1) {
              if (_rectconstraints._aspect !== PackerUtils.noAspect) {
                h = (w - margin) * _rectconstraints._aspect;
              } else {
                h = ((this._pass >= 2) && _minSize.height > Globals.packer.MinDimension)
                  ? _minSize.height + margin
                  : PackerUtils.setUndefinedLegLength(node, enclosingRect, reduction, "height", _minSize, _rectconstraints.margin);
              }
            }
          }
        } else if (_rectconstraints.prefSize.mode === "inches") {
          _rectconstraints.margin = _rectconstraints.marginInches * node.rect.dpi;
          w = _rectconstraints.prefSize.widthInches * node.rect.dpi + margin;
          h = _rectconstraints.prefSize.heightInches * node.rect.dpi + margin;
        } else {
          /* mode is pixels */
          let useMin = (this._pass >= 2) && _minSize.width > Globals.packer.MinDimension;
          if (useMin) {
            w = _minSize.width + margin;
          } else if (_rectconstraints.prefSize.width === -1) {
              if ((rect.height !== -1) || (rect.height === -1 && node.rect.width >= node.rect.height)) {
                w = PackerUtils.setUndefinedLegLength(node, enclosingRect, factor, "width", _minSize, _rectconstraints.margin);
              } else {
                w = node.rect.width * reduction;
                subdivide = true;
              }
          }
          useMin = (this._pass >= 2) && _minSize.height > Globals.packer.MinDimension;
          if (useMin) {
            h = _minSize.height + margin;
          }
          if (_rectconstraints.prefSize.height === -1) {
            h = subdivide
              ? PackerUtils.setUndefinedLegLength(node, enclosingRect, factor, "height", _minSize, _rectconstraints.margin)
              : ((this._pass >= 2) && _minSize.height > Globals.packer.MinDimension)
                ? (_rectconstraints._aspect === 0.0 ? _minSize.height
                    : PackerUtils.correctedSize(w, node.rect.height, _rectconstraints.margin, _rectconstraints._aspect, boundingW, boundingH).height)
                : node.rect.height * reduction;
            h += margin;
          }
        }
        if (_rectconstraints._aspect !== PackerUtils.noAspect) {
          const size = PackerUtils.correctedSize(w, h, _rectconstraints.margin, _rectconstraints._aspect, boundingW, boundingH);
          w = size.width;
          h = size.height;
        }
        if (w < _minSize.width || h < _minSize.height) {
          continue;
        }

        rect.width = w;
        rect.height = h;

        if (! this._shuffling) {
          if (rect.width > node.rect.width && node.rect.width > _minSize.width) {
            rect.width = node.rect.width;
          }
          if (rect.height > node.rect.height && node.rect.height > _minSize.height) {
            rect.height = node.rect.height;
          }
        }

        if (!PackerUtils.fitsIn(rect, node)) {
          /* node is too small */
          continue;
        }

        if (vcenter && ! PackerUtils.centered (node.rect, "vertical")) {
          continue;
        }

        /* -- ok to place it --- */
        if (_rectconstraints.prefSize.mode === "px" && PackerUtils.fitsExactly(rect, node)
          && (_rectconstraints._aspect === 0.0 || Util.isEqualwithPrecision(rect.height / rect.width, _rectconstraints._aspect, 0.001))) {

          // if (enclosingRect.width < Globals.absoluteMinSize.width && w > enclosingRect.width) { node.rect.width = enclosingRect.width; }
          // if (enclosingRect.height < Globals.absoluteMinSize.height && w > enclosingRect.height) { node.rect.height = enclosingRect.height; }
          return node;
        }

        /* just shuffling rects, no need to split */
        if (this._shuffling) {
          return node;
        }

        /* attempt to split the node in two to closely enclose the incoming node */

        /* split 3 way for vcenter */
        if (vcenter ) {
          if (rect.height < node.rect.height) {
            const divnode = this.centerNodeDivide(node, rect, "vertical");
            if (divnode.fitChild > -1) {
              while (divnode.fitChild > -1) {
                this._nodes.push(divnode.child[divnode.fitChild]);
                divnode.fitChild -= 1;
              }
              this._dropped.push(node);
              return divnode.child[1];
            }
            done = false;
            continue;
          } else if (rect.height === node.rect.height) {
            // adjust height to center it
            const center = node.rect.boundingHeight / 2;
            const adjH = (center - node.rect.y0) * 2;
            if (adjH < _minSize.height) {
              continue;
            }
            rect.height = adjH;
            if (_rectconstraints._aspect !== PackerUtils.noAspect) {
              rect.width = rect.height / _rectconstraints._aspect;
              if (rect.width < _minSize.width) {
                continue;
              }
            }
          }
        }

        const splitdir = this.getDivide(node.rect, rect);
        if (splitdir === "none") {
          /* didn't manage or didn't need to*/
          return node;
        }

        const ret = this.nodeDivide(splitdir, node, node.rect, rect, rect, false);
        if (!ret.hasOwnProperty("child")) {
          /* something went wrong, use entire node */
          return ret;
        }

        /* remove split node and append it's children to the node list */
        this._nodes.push(ret.child[0]);
        this._nodes.push(ret.child[1]);
        this._dropped.push (node);
        if (ret.fitChild > -1) {
          retNode = (ret.fitChild === 0) ? this._nodes[this._nodes.length - 2] : this._nodes[this._nodes.length - 1];
          if (_rectconstraints.prefSize.width === -1 || _rectconstraints.prefSize.height === -1) {
            return retNode;
          }
        }
        done = false;
      }
      this._dropped.forEach ((droppednode) => this._nodes = _.reject (this._nodes, droppednode));
      this._dropped = [];
    }

    return retNode;
  }

  /* -------------------------------------------------------------------------------------------------------------------------------------------------
   * tree node splitting
   */
  /**
   * determine which direction to divide the node, if at all possible
   * @param nodeToSplit
   * @param splitSize
   */
  private getDivide(nodeToSplit, splitSize) {
    const dw = nodeToSplit.width - splitSize.width;
    const dh = nodeToSplit.height - splitSize.height;

    if (dw < Globals.packer.MinDimension && dh < Globals.packer.MinDimension) {
      return "none";
    }

    return (dw >= dh && dw > Globals.packer.MinDimension) ? "width" : dh > Globals.packer.MinDimension ? "height" : "none";
  }

  /**
   * divides a populated node in two : child1 is splitSize, child2 contains the remainder
   * current component stays in child1 , incoming component in child2 unless anchor and size constraints
   * dictate otherwise
   * @param splitdir              - on the horizontal leg (width) or vertical leg (height)
   * @param nodeToSplit           - node to be split
   * @param rectToSplit           - rectangle occupying the node to be split
   * @param splitSize             - desired resulting dimensions
   * @param incomingRect          - the rectangle we're doing the split for
   * @param primary               - force a split, used when splitting to preserve aspect ratio
   */
  private nodeDivide(splitdir, nodeToSplit, rectToSplit, splitSize, incomingRect, primary) {
    const child1 = Util.clone (nodeToSplit.rect);
    const child2 = Util.clone (nodeToSplit.rect);

    child1.width = rectToSplit.width;
    child1.height = rectToSplit.height;
    child1.componentId = nodeToSplit.occupiedBy;
    child2.componentId = null;

    nodeToSplit.fitChild = -1;

    let _incomingConstraints = incomingRect.constraints;
    let _rectToSplitConstraints = rectToSplit.constraints;
    let _nodeToSplitConstraints = nodeToSplit.rect.constraints;
    if (this._isMixed && ! nodeToSplit.rect.communal) {
      _incomingConstraints = incomingRect.personalconstraints;
      _rectToSplitConstraints = rectToSplit.personalconstraints;
      _nodeToSplitConstraints = nodeToSplit.rect.personalconstraints;
    }

    let flipdir = false;
    if (splitdir === "width") {
      const incomingAnchoredRight = PackerUtils.anchoredRight(_incomingConstraints);
      const tenantAnchoredRight = PackerUtils.anchoredRight(_nodeToSplitConstraints)
        && nodeToSplit.occupiedBy != null && incomingRect.componentId !== nodeToSplit.occupiedBy;

      if (incomingAnchoredRight && tenantAnchoredRight) {
        /* this shouldn't have happened, but they cannot share this node! */
        return nodeToSplit;
      }
      flipdir = tenantAnchoredRight || ( incomingAnchoredRight);
      if (flipdir) {
        if (((nodeToSplit.occupiedBy === null) && primary) || (nodeToSplit.occupiedBy === incomingRect.componentId)) {
          child1.width = splitSize.width;
          child2.width = rectToSplit.width - child1.width;
          child1.x0 = rectToSplit.x0 + child2.width;
        } else {
          child2.width = splitSize.width;
          child1.width = rectToSplit.width - child2.width;
          child2.x0 = rectToSplit.x0 + child1.width;
        }
      } else {
        child1.width = splitSize.width;
        child2.width = rectToSplit.width - child1.width;
        child2.x0 = rectToSplit.x0 + child1.width;
      }
    } else {

      // todo:  for now don't split vertically centered node by height
      // if (PackerUtils.anchoredVCenter(nodeToSplit.rect) && nodeToSplit.occupiedBy != null) {
      //   return nodeToSplit;
      // }

      const incomingAnchoredBottom = PackerUtils.anchoredBottom(_incomingConstraints);
      const tenantAnchoredBottom = PackerUtils.anchoredBottom(_nodeToSplitConstraints)
        && nodeToSplit.occupiedBy != null && incomingRect.componentId !== nodeToSplit.occupiedBy;

      if (incomingAnchoredBottom && tenantAnchoredBottom) {
        /* this shouldn't have happened, but they cannot share this node! */
        return nodeToSplit;
      }
      flipdir = tenantAnchoredBottom || ( incomingAnchoredBottom);
      if (flipdir) {
        if ((nodeToSplit.occupiedBy === null && primary) || (nodeToSplit.occupiedBy === incomingRect.componentId)) {
          child1.height = splitSize.height;
          child2.height = rectToSplit.height - child1.height;
          child1.y0 = rectToSplit.y0 + child2.height;
          nodeToSplit.fitChild = 0;
        } else {
          child2.height = splitSize.height;
          child1.height = rectToSplit.height - child2.height;
          child2.y0 = rectToSplit.y0 + child1.height;
          nodeToSplit.fitChild = 1;
        }
      } else {
        child1.height = splitSize.height;
        child2.height = rectToSplit.height - child1.height;
        child2.y0 = rectToSplit.y0 + child1.height;
        nodeToSplit.fitChild = 0;
      }
    }

    /* verify after split rects will meet mininum size constraint */
    const incomingMin = PackerUtils.toPixelResolution(_incomingConstraints.minSize, PackerUtils.minRect, nodeToSplit.rect);
    if (nodeToSplit.occupiedBy != null) {
      const child1Min = PackerUtils.toPixelResolution(flipdir ? _incomingConstraints.minSize : _nodeToSplitConstraints.minSize,
                                                        PackerUtils.minRect, nodeToSplit.rect);
      if (!isNullOrUndefined(child1.componentId) && (child1.width < child1Min.width || child1.height < child1Min.height)) {
        return nodeToSplit;
      }
      if (!isNullOrUndefined(child2.componentId) && (child2.width < incomingMin.width || child2.height < incomingMin.height)) {
        return nodeToSplit;
      }
    } else {
      if (flipdir && !primary) {
        if (child2.width < incomingMin.width || child2.height < incomingMin.height) {
          return nodeToSplit;
        }
        nodeToSplit.fitChild = 1;
      } else {
        if (child1.width < incomingMin.width || child1.height < incomingMin.height) {
          return nodeToSplit;
        }
        nodeToSplit.fitChild = 0;
      }
    }

    nodeToSplit.child = [];
    nodeToSplit.child.push({
      id:     PackerUtils.uuid(),
      rect:   child1,
      occupiedBy: nodeToSplit.occupiedBy,
    });
    nodeToSplit.child.push({
      id:     PackerUtils.uuid(),
      rect:   child2,
      occupiedBy: null,
    });

    if (nodeToSplit.occupiedBy != null) {
      this._updates.push (Util.clone(nodeToSplit.child[0]));
    }

    nodeToSplit.occupiedBy = null;
    return nodeToSplit;
  }

  /**
   * split a node to accomodate a centered rectangle
   * @param node
   * @param rect
   * @param direction
   * @param force
   */
  private centerNodeDivide(node: Node, rect: PackerRectangle, direction: string, force: boolean = false): Node {
    node.fitChild = -1;

    // todo: for now
    if (! isNullOrUndefined(node.occupiedBy) && ! force) {
      return node;
    }

    if (direction === "horizontal") {
      // todo: implement
      return node;
    }

    const children: Node[] = [];

    const dw = node.rect.width - rect.width;
    const w = dw > Globals.packer.MinDimension ? dw : node.rect.width;

    /* top slice */
    let child = Util.clone(node);
    child.id = PackerUtils.uuid();
    child.rect.width = w;
    child.rect.height = (node.rect.height - rect.height) / 2;
    child.rect.y0 = node.rect.y0;
    children.push(child);

    /* center */
    child = Util.clone(node);
    child.id = PackerUtils.uuid();
    child.rect.width = w;
    child.rect.height = rect.height;
    child.rect.y0 = node.rect.y0 + children[0].rect.height;
    children.push(child);

    /* bottom slice */
    child = Util.clone(node);
    child.id = PackerUtils.uuid();
    child.rect.width = w;
    child.rect.height = node.rect.height - children[0].rect.height - children[1].rect.height;
    child.rect.y0 = node.rect.y0 + children[0].rect.height + children[1].rect.height;
    children.push(child);

    /* right margin */
    if (dw > Globals.packer.MinDimension) {
      child = Util.clone(node);
      child.id = PackerUtils.uuid();
      child.rect.height = node.rect.height;
      child.rect.y0 = node.rect.y0;
      child.rect.width = dw;
      child.rect.x0 = rect.width;
      children.push(child);
      node.fitChild += 1;
    }

    node.child = children;
    node.fitChild += 3;
    return node;
  }

  /* ------------------------------------------------------------------------------------- */

  /**
   * return true if the constraints specify a preferred size
   * @param constraints
   */
  private hasPreferredSize(constraints: ILayoutConstraint): boolean {

    if (!constraints.hasOwnProperty("prefSize") ) {
      return false;
    }

    return constraints.prefSize.width !== -1 && constraints.prefSize.height !== -1;
  }

  /**
   * find node options to split that has no preferred size defined, best option at head of the list
   * @return sorted list of all node options for splitting
   * @param r - rectangle to place for which we are splitting
   * @param reduction
   */
  private findSplitNodeOptions(r: PackerRectangle, reduction: number): SplitOption[] {
    const options = this.findSplitNodeTraversal(r, reduction);

    if (!_.isEmpty(options)) {
      options.sort((a, b) => {
        /* give preference to unoccupied nodes */
        if (( a.node.occupiedBy === null) && (b.node.occupiedBy === null)) {
          return PackerUtils.larger_first(a.node.rect, b.node.rect);
        }
        if (a.node.occupiedBy === null) {
          return -1;
        }
        if (b.node.occupiedBy === null) {
          return 1;
        }

        const aConstraints = PackerUtils.resolveConstraints(a.node, this._isMixed, a.node.rect);
        const bConstraints = PackerUtils.resolveConstraints(b.node, this._isMixed, b.node.rect);

        const prefA = this.hasPreferredSize(aConstraints);
        const prefB = this.hasPreferredSize(bConstraints);
        if (! prefA && prefB) {
          return -1;
        }
        if (prefA && (! prefB)) {
          return 1;
        }

        if (aConstraints.priority > bConstraints.priority) {
          return 1;
        }
        if (aConstraints.priority < bConstraints.priority) {
          return -1;
        }

        return PackerUtils.larger_first (a.node.rect, b.node.rect);
      });
    }

    return options;
  }

  /**
   * find all nodes that can be split to place the rectangle
   * @return - list of all node options for splitting
   * @param rect
   * @param reduction
   */
  private findSplitNodeTraversal(rect: PackerRectangle, reduction: number): SplitOption[] {
    const optionList: SplitOption[] = [];

    for (const n in this._nodes) {
      const node = this._nodes[n];

      const _rectConstraints = PackerUtils.resolveConstraints(node, this._isMixed, rect);
      const _nodeConstraints = PackerUtils.resolveConstraints(node, this._isMixed, node.rect);

      if (! PackerUtils.validRegion(_rectConstraints.valid, node.rect)) {
        continue;
      }

      if (! PackerUtils.fitsIn(rect, node) || !PackerUtils.meetsMinReq(node.rect, _rectConstraints.minSize, node.rect)) {
        continue;
      }
      const anchored = _rectConstraints.hasOwnProperty("anchor");
      const bBox: BBox = PackerUtils.computeBounds (rect, node.rect, anchored, reduction, _rectConstraints);

      let anchoredLeft = false;
      let anchoredRight = false;
      let anchoredTop = false;
      let anchoredBottom = false;
      let spansWidth = false;
      let spansHeight = false;
      let anchoredVCenter = false;

      const tenantAnchoredLeft = PackerUtils.anchoredLeft(_nodeConstraints);
      const tenantAnchoredRight = PackerUtils.anchoredRight(_nodeConstraints);
      const tenantAnchoredTop = PackerUtils.anchoredTop(_nodeConstraints);
      const tenantAnchoredBottom = PackerUtils.anchoredBottom(_nodeConstraints);
      const tenantAnchoredVCenter = PackerUtils.anchoredVCenter(_nodeConstraints);

      /* verify splitting will honor anchors */
      if (anchored) {
        anchoredLeft = PackerUtils.anchoredLeft(_rectConstraints);
        if (anchoredLeft && node.rect.x0 > 0 ) {
          continue;
        }
        anchoredRight = PackerUtils.anchoredRight(_rectConstraints);
        if (anchoredRight && (node.rect.x0 + node.rect.width < bBox.boundingWidth)) {
          continue;
        }
        anchoredTop = PackerUtils.anchoredTop(_rectConstraints);
        if (anchoredTop && node.rect.y0 > 0) {
          continue;
        }
        anchoredBottom = PackerUtils.anchoredBottom(_rectConstraints);
        if (anchoredBottom && (node.rect.y0 + node.rect.height < bBox.boundingHeight)) {
          continue;
        }
        spansWidth = anchoredRight && anchoredLeft;
        spansHeight = anchoredTop && anchoredBottom;
        if (spansWidth && spansHeight) {
          continue;
        }

        anchoredVCenter = PackerUtils.anchoredVCenter(_rectConstraints);
        if (anchoredVCenter && !PackerUtils.centered(node.rect, "vertical")) {
          continue;
        }
      }

      const minsize = PackerUtils.toPixelResolution(_rectConstraints.minSize, PackerUtils.minRect, node.rect, _rectConstraints._aspect);
      if (!PackerUtils.meetsMinReq(node.rect, minsize, node.rect)) {
        continue;
      }

      if (node.occupiedBy == null) {
        if (anchoredVCenter) {
          const h = ((node.rect.boundingHeight / 2) - node.rect.y0) * 2;
          if (h < minsize.height) {
            continue;
          }
          if (_rectConstraints._aspect !== PackerUtils.noAspect && (h / _rectConstraints._aspect < minsize.width)) {
            continue;
          }
          optionList.push({
            node,
            split: "vcenter",
          });
        } else {
          optionList.push({
            node,
            split: "none",
          });
        }
        continue;
      }

      const affixedVerticalEdge = (anchoredTop && tenantAnchoredTop) || (anchoredBottom && tenantAnchoredBottom);
      const affixedHorizontalEdge = (anchoredLeft && tenantAnchoredLeft) || (anchoredRight && tenantAnchoredRight);

      const nodeSpansWidth = tenantAnchoredLeft && tenantAnchoredRight;
      const nodeSpansHeight = tenantAnchoredTop && tenantAnchoredBottom;

      let canSplitWidth = !nodeSpansWidth && !spansWidth && !affixedHorizontalEdge;
      let canSplitHeight = !nodeSpansHeight && !spansHeight && !affixedVerticalEdge && !tenantAnchoredVCenter;

      const tenantMinsize = PackerUtils.toPixelResolution(_nodeConstraints.minSize, PackerUtils.minRect, node.rect, _nodeConstraints._aspect);
      if (tenantMinsize.width >= node.rect.width) {
        canSplitWidth = false;
      }
      if (tenantMinsize.height >= node.rect.height) {
        canSplitHeight = false;
      }

      /* non-splittable conditions */
      if (!(canSplitHeight || canSplitWidth)) {
        continue;
      }
      if (affixedHorizontalEdge && affixedVerticalEdge) {
        continue;
      }
      if (nodeSpansWidth && nodeSpansHeight) {
        continue;
      }

      if (_nodeConstraints.prefSize.width === -1 && _nodeConstraints.prefSize.height === -1) {
        let splitdir: string = "none";
        if (affixedVerticalEdge && canSplitWidth) {
          splitdir = "width";
        } else if (affixedHorizontalEdge && canSplitHeight) {
          splitdir = "height";
        } else if (node.rect.width >= node.rect.height && canSplitWidth) {
          splitdir = "width";
        } else if (canSplitHeight) {
          splitdir = "height";
        }
        if (splitdir !== "none") {
          optionList.push({ node, split: splitdir });
        }
      } else if (_nodeConstraints.prefSize.width === -1 && canSplitWidth) {
        optionList.push({ node, split: "width" });
      } else if (_nodeConstraints.prefSize.height === -1 && (!anchoredTop || !tenantAnchoredTop)
        && (!anchoredBottom || !tenantAnchoredBottom) && canSplitHeight) {
        optionList.push({ node, split: "height" });
      } else {
        const pixels = PackerUtils.toPixelResolution(_nodeConstraints.prefSize, minsize, bBox);
        if (node.rect.width > node.rect.height
          && pixels.width <= node.rect.width
          && canSplitWidth) {
          optionList.push({ node, split: "width" });
        } else if (canSplitHeight) {
          optionList.push({ node, split: "height" });
        }
      }
      continue;
    }

    return optionList;
  }

  /**
   * splits a populated node to insert a new one
   * @return the split node that will hold the rectangle
   * @param node
   * @param splitdir
   * @param rect
   * @param reduceFactor
   */
  private splitNode(node: Node, splitdir: string, rect: PackerRectangle, reduceFactor: number): Node {
    let placedNode: Node = null;

    const _rectConstraints = PackerUtils.resolveConstraints(node, this._isMixed, rect);
    const _nodeConstraints = PackerUtils.resolveConstraints(node, this._isMixed, node.rect);

    const bbox = {
      width: node.rect.boundingWidth * reduceFactor,
      height: node.rect.boundingHeight * reduceFactor,
      boundingWidth: node.rect.boundingWidth,
      boundingHeight: node.rect.boundingHeight,
    };

    /* child 0 <- node's rectangle
     * child 1 <- rect
     */
    const child1 = Util.clone(node.rect);
    const child2 = Util.clone(node.rect);

    const min = PackerUtils.toPixelResolution(_nodeConstraints.minSize, PackerUtils.minRect, bbox) ;
    const minRect = PackerUtils.toPixelResolution(_rectConstraints.minSize, PackerUtils.minRect, bbox) ;

    const d = this.computeSplitDimensions (node.rect, bbox, splitdir, min, minRect, _nodeConstraints, _rectConstraints);
    child1.width  = d.child1.width;
    child1.height = d.child1.height;
    child2.width  = d.child2.width;
    child2.height = d.child2.height;

    /* verify it is splittable */
    if (child2.width <= 0 || child2.height <= 0) {
      return null;
    }
    if (child1.width < min.width ) {
      child1.width = min.width;
      child2.width = node.rect.width - child1.width;
    }
    if (child1.height < min.height) {
      child1.height = min.height;
      child2.height = node.rect.height - child1.height;
    }
    if (child2.width < minRect.width || child2.height < minRect.height) {
      return null;
    }

    if (_rectConstraints._aspect !== PackerUtils.noAspect) {
      let size = PackerUtils.directed_aspect_correct (child2.width, child2.height, _rectConstraints._aspect, _rectConstraints.margin, splitdir);
      if (splitdir === "height" && size.width < minRect.width) {
        size = PackerUtils.directed_aspect_correct_no_check (minRect.width, child2.height,
                                                              _rectConstraints._aspect, _rectConstraints.margin, "width");
        if (size.height < minRect.height) {
          return null;
        }
        child2.height = size.height;
        child1.height = node.rect.height - child2.height;
        if (child1.width < min.width || child1.height < min.height) {
          return null;
        }
      }
    }

    if (splitdir === "width") {
      if ((PackerUtils.anchoredLeft (_rectConstraints) && ! PackerUtils.anchoredLeft (_nodeConstraints))
        || PackerUtils.anchoredRight(_nodeConstraints)) {
        child1.x0 = node.rect.x0 + child2.width;
      } else {
        child2.x0 = node.rect.x0 + child1.width;
      }
    } else if (splitdir === "height") {
      if ((PackerUtils.anchoredTop (_rectConstraints) && ! PackerUtils.anchoredTop (_nodeConstraints))
        || PackerUtils.anchoredBottom(_nodeConstraints)) {
        child1.y0 = node.rect.y0 + child2.height;
      } else {
        child2.y0 = node.rect.y0 + child1.height;
      }
    } else if (splitdir === "vcenter") {
      /* three way */
    }

    if (this._isMixed) {
      child2.constraints = Util.clone(rect.constraints);
      child2.personalconstraints = Util.clone(rect.personalconstraints);
    } else {
      child2.constraints = Util.clone(_rectConstraints);
    }

    let c1: Node = {
      id: PackerUtils.uuid(),
      rect: child1,
      occupiedBy: node.occupiedBy,
    };
    let c2: Node = {
      id: PackerUtils.uuid(),
      rect: child2,
      occupiedBy: rect.componentId,
    };
    placedNode  = c2;

    /* maintain aspect ration for both newly split children nodes */
    c1 = this.aspect_adjust_with_split (c1, Util.clone(c1.rect), splitdir, false, min);
    c2 = this.aspect_adjust_with_split (c2, Util.clone(c2.rect), splitdir, false, minRect);

    if (c1.split === "failed" || c2.split === "failed") {
      return null;
    }

    if (c1.split === "none") {
      this._updates.push(c1);
      this._nodes.push(c1);
    } else if (c1.split === "vcenter") {
      c1.child[1].occupiedBy =  node.occupiedBy;
      c1.occupiedBy = null;
      c1.child[0].occupiedBy = null;
      c1.child[2].occupiedBy = null;
      this._updates.push (c1.child[1]);
      this._nodes.push (c1.child[0]);
      this._nodes.push (c1.child[1]);
      this._nodes.push (c1.child[2]);
    } else {
      c1.child[0].occupiedBy =  node.occupiedBy;
      c1.occupiedBy = null;
      c1.child[1].occupiedBy = null;
      this._updates.push (c1.child[0]);
      this._nodes.push (c1.child[0]);
      this._nodes.push (c1.child[1]);
    }

    if (c2.split === "none") {
      rect.x0 = child2.x0;
      rect.y0 = child2.y0;
      rect.width = child2.width;
      rect.height = child2.height;
      this._updates.push(c2);
      this._nodes.push (c2);
    } else if (c1.split === "vcenter") {
      rect.x0 = c2.child[1].rect.x0;
      rect.y0 = c2.child[1].rect.y0;
      rect.width = c2.child[1].rect.width;
      rect.height = c2.child[1].rect.height;
      c2.child[1].occupiedBy =  rect.componentId;
      c2.occupiedBy = null;
      c2.child[0].occupiedBy = null;
      c2.child[2].occupiedBy = null;
      this._updates.push (c2.child[1]);
      this._nodes.push (c2.child[0]);
      this._nodes.push (c2.child[1]);
      this._nodes.push (c2.child[2]);
      placedNode = c2.child[1];
    } else {
      rect.x0 = c2.child[0].rect.x0;
      rect.y0 = c2.child[0].rect.y0;
      rect.width = c2.child[0].rect.width;
      rect.height = c2.child[0].rect.height;
      c2.child[0].occupiedBy = rect.componentId;
      c2.occupiedBy = null;
      this._updates.push (c2.child[0]);
      c2.child[1].occupiedBy = null;
      this._nodes.push (c2.child[0]);
      this._nodes.push (c2.child[1]);
      placedNode = c2.child[0];
    }

    this._nodes = _.reject (this._nodes, node);
    return placedNode;
  }

  /**
   * calculate the split width and height using the incoming rectangle and the rectangle's that is occupying the node constraints
   * @return the split dimensions to be used
   * @param node
   * @param bbox
   * @param dim
   * @param minsize
   * @param minRect
   * @param _nodeConstraints
   * @param _rectConstraints
   */
  private computeSplitDimensions(node, bbox, dim, minsize, minRect, _nodeConstraints, _rectConstraints) {
    const splitDim = {
      child1: {
        width: node.width,
        height: node.height,
      },
      child2: {
        width: node.width,
        height: node.height,
      },
    };

    if (dim === "vcenter") {
      const midpt = node.boundingHeight / 2;
      splitDim.child1.height = (node.y0 - midpt) * 2;
      splitDim.child2.height = node.height - splitDim.child1.height;
      return splitDim;
    }

    splitDim.child1[dim] = node[dim] / 2;
    splitDim.child2[dim] = node[dim] -  splitDim.child1[dim];

    /* neither rectangle has size preferrence
     * attempt to insure both are larger than specified minimum dimension
     * giving priority to that with the higher priority
     */
    if (_nodeConstraints.prefSize[dim] === -1 && _rectConstraints.prefSize[dim] === -1) {
      if ((splitDim.child1[dim] >= minsize[dim]) && splitDim.child2[dim] >= minRect[dim]) {
        return splitDim;
      }
      if (_nodeConstraints.priority >= _rectConstraints.priority) {
        if (splitDim.child1[dim] < minsize[dim]) {
          splitDim.child1[dim] = minsize[dim];
          splitDim.child2[dim] = node[dim] - splitDim.child1[dim];
          return splitDim;
        }
        splitDim.child2[dim] = minRect[dim];
        splitDim.child1[dim] = node[dim] - splitDim.child2[dim];
        return splitDim;
      }
      if (splitDim.child2[dim] < minsize[dim]) {
        splitDim.child2[dim] = minsize[dim];
        splitDim.child1[dim] = node[dim] - splitDim.child2[dim];
        return splitDim;
      }
      splitDim.child1[dim] = minRect[dim];
      splitDim.child2[dim] = node[dim] - splitDim.child1[dim];
      return splitDim;
    }

    const minDim = minsize[dim]; // PackerUtils.toPixelResolution(node.minSize, PackerUtils.minRect, bbox)[dim];

    /* one of the rectangles cares the other doesn't,
     * give priority to the caring rectangle
     * as long as both are at least of minimum length
     */
    if (_rectConstraints.prefSize[dim] === -1) {
      if (splitDim.child1[dim] > minDim && splitDim.child2[dim] > minRect[dim]) {
        return splitDim;
      }
      splitDim.child2[dim] = _.min([minRect[dim], node[dim] - minDim]);
      splitDim.child1[dim] = node[dim] - splitDim.child2[dim];
      return splitDim;
    }

    const preferredRectLeg = _rectConstraints.prefSize.mode === "percent"
      ? (bbox[dim] * _rectConstraints.prefSize[dim]) / 100.0
      : _rectConstraints.prefSize.mode === "inches"
        ? _nodeConstraints.prefSize[dim + "Inches"] * (node.dpi)
        : _rectConstraints.prefSize[dim];

    if (_nodeConstraints.prefSize[dim] === -1 || _rectConstraints.priority > _nodeConstraints.priority) {
      if (node[dim] - preferredRectLeg > minDim) {
        splitDim.child2[dim] = preferredRectLeg;
        splitDim.child1[dim] = node[dim] - preferredRectLeg;
        return splitDim;
      }
      if (splitDim.child1[dim] > minDim && splitDim.child2[dim] > minRect[dim]) {
        return splitDim;
      }
      splitDim.child2[dim] = _.max([minRect[dim] , node[dim] - minDim ]);
      splitDim.child1[dim] = node[dim] - splitDim.child2[dim];
      return splitDim;
    }

    /* both care */
    if (splitDim.child1[dim] > minDim && splitDim.child2[dim] > minRect[dim]) {
      return splitDim;
    }
    splitDim.child1[dim] = _.max([minDim, node[dim] - minRect[dim]]);
    splitDim.child2[dim] = node[dim] - splitDim.child1[dim];
    return splitDim;
  }

  /*
   * -------------------------------------------------------------------------------------------------------------------------------------------------
   * tree node splitting -- aspect ratio maintainance
   */
  /**
   * correct the size of the node to maintain aspect ratio if specified.
   * if the correction leaves white space on the width and height greater than the minimum splittable size
   * split the node into two or three nodes as appropriate
   * @return the size adjusted Node
   * @param splitnode   - node to be split
   * @param splitrect   - rectangle occupying the node
   * @param primaryDir  - preferred split direction
   * @param primary     - force
   * @param minsize     - minimum splittable dimensions
   */
  private aspect_adjust_with_split(splitnode: Node, splitrect: PackerRectangle, primaryDir: string, primary: boolean, minsize: object): Node {
    const _rectConstraints = PackerUtils.resolveConstraints(splitnode, this._isMixed, splitrect);

    if (_rectConstraints._aspect === PackerUtils.noAspect) {
      splitnode.split = "none";
      return splitnode;
    }

    const margin = _rectConstraints.hasOwnProperty("marginInches") ?
      _rectConstraints.marginInches * splitnode.rect.dpi : _rectConstraints.hasOwnProperty("margin") ? _rectConstraints.margin : 0;

    /* adjust size to maintain requested aspect ratio */
    // const size = PackerUtils.directed_aspect_correct (splitrect.width, splitrect.height, splitrect.aspect, margin, primaryDir);
    const size = PackerUtils.directed_aspect_correct_ (splitrect.width, splitrect.height, _rectConstraints._aspect, margin, primaryDir, minsize);
    const adjusted = Util.clone (splitrect);
    adjusted.width = size.width;
    adjusted.height = size.height;

    const vcenter = PackerUtils.anchoredVCenter(_rectConstraints);
    if (vcenter && adjusted.height < splitnode.rect.height) {
      splitrect.width = adjusted.width;
      splitrect.height = adjusted.height;
      const divnode = this.centerNodeDivide(splitnode, splitrect, "vertical", true);
      splitnode.split = divnode.fitChild > -1 ? "vcenter" : "failed";
      return splitnode;
    }

    const splitdir = this.getDivide (splitrect, adjusted);
    // if (splitdir === "height" && ((!isNullOrUndefined(splitnode.occupiedBy) && PackerUtils.anchoredVCenter(splitnode.rect))
    // || PackerUtils.anchoredVCenter(splitrect))) {
    //   splitdir = "none";
    // }
    if (splitdir === "none" || (splitnode.rect[splitdir] - adjusted[splitdir] < Globals.packer.MinDimension)) {
      splitrect.width = adjusted.width;
      splitrect.height = adjusted.height;
      splitnode.rect.width = adjusted.width;
      splitnode.rect.height = adjusted.height;
      splitnode.split = "none";

    } else {
      // console.log('++++ splitting a split child ++++ ');
      if (splitnode.occupiedBy != null) {
        splitrect.componentId = splitnode.occupiedBy;
      }

      const ret = this.nodeDivide(splitdir, splitnode, splitrect, adjusted, splitrect, primary);
      splitnode = ret;
      splitnode.split = ret.hasOwnProperty("child") ? splitdir : "failed";
    }

    return splitnode;
  }

  /**
   * correct the size of the node to maintain aspect ratio if specified.
   * if the correction leaves white space on the width and height greater than the minimum splittable size
   * split the node into two or three nodes as appropriate
   * FORCE the correction even if there was some failure
   * @param splitnode
   * @param splitrect
   * @param primaryDir
   * @param minsize
   */
  private aspect_adjust_nofail(splitnode: Node, splitrect: PackerRectangle, primaryDir: string, minsize: PackingSize) {
    const adjusted = this.aspect_adjust_with_split (splitnode, splitrect, primaryDir, true, minsize);

    if (adjusted.split !== "none" && adjusted.split !== "failed") {
      this.updateNodelistAfterSplit (adjusted.child, splitnode );
      return adjusted.child[0];
    }

    const rconstraints = PackerUtils.resolveConstraints(splitnode, this._isMixed, splitrect);
    const corrected
      = PackerUtils.getAspectCorrectedComponentSize(splitrect.width, splitrect.height, rconstraints.margin, rconstraints._aspect,
                                                       splitrect.width, splitrect.height);
    splitnode.rect.width = corrected.width;
    splitnode.rect.height = corrected.height;
    splitnode.split = "failed";
    return splitnode;
  }

  /**
   * cover function that updates the nodelist after the list was performed.
   * @return adjusted node
   * @param node
   * @param rect
   * @param split
   * @param minsize
   */
  private aspectSplit(node: Node, rect: PackerRectangle, split: string, minsize: PackingSize): Node {
    const adj = this.aspect_adjust_with_split (node, rect, split, true, minsize);
    switch (adj.split) {
      case "failed":
        return null;
      case "none":
        return adj;
      case "width":
      case "height":
        this.updateNodelistAfterSplit (adj.child, node);
        return adj.child[0];
    }
    return null;
  }

  /**
   * replace the node in the global list with it's split parts
   * @param split
   * @param originalNode
   */
  private updateNodelistAfterSplit(split: Node[], originalNode: Node): void {
    this._nodes.push (split[0]);
    this._nodes.push (split[1]);
    this._nodes = _.reject (this._nodes, originalNode);
  }

  /**
   * after each pass in the algorithm consolidate white space -- i.e., unoccupied adjacent nodes, into larger
   * ones before moving on.
   * used to avoid fragmenation
   * @return new packing result
   * @param nodes
   * @param rects
   * @param reduction
   * @param force
   * @private
   */
  private _packer_pass(nodes: Node[], rects: PackerRectangle[], reduction: number, force: boolean = false): Packing {
    const pass: Packing = this.packer(nodes, rects, reduction);
    /* consolidate white space caused by aspect ratio changes for nodes */
    const updates: PackerNode[] = this.consolidateNodes(force);
    updates.forEach ((item) => {
      if (! isNullOrUndefined(item.occupiedBy)) {
        const rect = pass.rects.find ((r) => (r.componentId === item.occupiedBy));
        const _rectConstraints = PackerUtils.resolveConstraints(item, this._isMixed, rect);
        rect.x0 = item.rect.x0;
        rect.y0 = item.rect.y0;
        rect.width = item.rect.width;
        rect.height = item.rect.height;
        if (_rectConstraints._aspect !== PackerUtils.noAspect) {
          const corrected
            = PackerUtils.correctedSize(rect.width, rect.height, _rectConstraints.margin,
                                        _rectConstraints._aspect, item.rect.width, item.rect.height);
          const minsize = PackerUtils.toPixelResolution(_rectConstraints.minSize, PackerUtils.minRect, item.rect);
          if (corrected.width >= minsize.width && corrected.height >= minsize.height) {
            rect.width = corrected.width;
            rect.height = corrected.height;
          } else {
            rect.x0 = -1;
            rect.y0 = -1;
            rect.width = -1;
            rect.height = -1;
          }
        }
      }
    });
    return pass;
  }

  /**
   * intention is to refit the components into the resultant node list for aesthetics.
   * in general it is preferred to have white space at right and bottom borders rather than as holes in the middle
   *
   * re-arranges the components in the created tree to eliminated splitting affects caused by aspect ratio fitting
   * this happens when working with several same-sized same priority components
   *
   * have a known set of rectangles and boxes
   * sort boxes from smallest to largest
   * sort components (rectangles to be fit) from largest to smallest
   * fit each rectangle (while verifying anchor & device constraints)
   *
   * @return new packed layout result
   * @param packed     -- current packed layout
   * @param reduction  -- factor used in current packing
   * @private
   */
  private __beautify(packed, reduction) {
    /* re-arrange the components in the created tree to eliminated splitting affects caused by aspect ratio fitting
     * this happens when working with several same-sized same priority components
     *
     * have a known set of rectangles and boxes
     * sort boxes from smallest to largest
     * sort components (rectangles to be fit) from largest to smallest
     * fit each rectangle (while verifying anchor & device constraints)
     */

    const firstPass = {
      nodes: Util.clone(this._nodes),
      rects: Util.clone(packed.rects),
    };

    const pruner = PackerUtils.prunePrefRegions({
      trees: this._nodes,
      rects: packed.rects,
      prunedTrees: [],
      prunedRects: [],
    }, !this._beautifyPrefsize);

    if (pruner.trees.length < 1 || pruner.rects.length < 2) {
      /* nothing much to do */
      packed.rects = firstPass.rects;
      packed.trees = firstPass.nodes;
      return packed;
    }

    this._nodes = pruner.trees;
    packed.rects = pruner.rects;

    this._nodes.sort((a, b) => {
      return PackerUtils.larger_tl(a.rect, b.rect);
    });

    /* clearNodeOccupants */
    this._nodes.forEach((node) => node.occupiedBy = null);

    packed.rects.forEach((rect) => this.__clearLayout(rect));
    packed.rects.sort((a, b) => {
      return PackerUtils.larger_tl(a, b);
    });

    /* place the components into existing nodes without further splitting to better arrange */
    this._shuffling = true;
    let beautified: Packing = this._packer_pass(this._nodes, packed.rects, reduction);

    const utilized1 = PackerUtils.computeFillSpace(firstPass.rects);
    let utilized2 = PackerUtils.computeFillSpace(beautified.rects);

    /* force top left ordering */
    if (!PackerUtils.orderedTopLeft(this._nodes)) {
      this._pass = 4;
      this._nodes.sort((a, b) => {
        return PackerUtils.larger_tl(a.rect, b.rect);
      });
      this._nodes.forEach((node) => node.occupiedBy = null);
      beautified.rects.forEach((rect) => this.__clearLayout(rect));
      beautified.rects.sort((a, b) => {
        return PackerUtils.largerDimArea(a, b);
      });
      const passThree: Packing = this._packer_pass(this._nodes, beautified.rects, reduction);
      const utilized3 = PackerUtils.computeFillSpace(passThree.rects);
      if (beautified.rects.length <= passThree.rects.length || (utilized3 >= utilized2)) {
        /* use the new "better" layout */
        beautified = passThree;
        utilized2 = utilized3;
      }
    }
    this._shuffling = false;
    beautified.rects = beautified.rects.concat(pruner.prunedRects);
    utilized2 += PackerUtils.computeFillSpace(pruner.prunedRects);

    /* choose packing with least white space */
    if (beautified.rects.length < firstPass.rects.length || (utilized2 < utilized1)) {
      /* didn't go a good enough job, ditch the beautify */
      packed.rects = firstPass.rects;
      packed.trees = firstPass.nodes;
    } else {
      packed.rects = beautified.rects;
      packed.trees = beautified.tree;
    }

    return packed;
  }

  /**
   * clear the rectangle's current layout data
   * @param rect
   * @private
   */
  private __clearLayout(rect: PackerRectangle) {
    rect.x0 = -1;
    rect.y0 = -1;
    rect.width = -1;
    rect.height = -1;
    rect.deviceId = null;
    rect.regionId = null;
  }

  /* ============================================================
   * combine unoccupied neighboring nodes
   */

  /**
   * driver function:
   * loop over node set and try to consolidate adjacent nodes
   * then sort the results
   * changes are performed in place in this._nodes
   * @param lastPlacedRegion
   */
  private consolidateWhiteNodes(lastPlacedRegion: string): void {
    if (this._nodes.length < 2) {
      return;
    }
    if (! this._shuffling) {
      /* consolidate neighboring unoccupied blocks */
      this._nodes.forEach((node) => {
        node.dropped = false;
      });
      const toDrop: Node[] = [];
      for (const i in this._nodes) {
        const node = this._nodes[i];
        if (isNullOrUndefined(node.occupiedBy) && !node.dropped) {
          while (this._consolidate(node, toDrop)) {
            continue;
          }
        }
      }
      toDrop.forEach((n) => {
        this._nodes = _.reject(this._nodes, n);
      });
      this._nodes.sort((a, b) => {
        return PackerUtils.larger_first(a.rect, b.rect);
      });
      if (this.alternateRegions) {
        if (this._nodes[0].rect.regionId === lastPlacedRegion) {
          for (let i = 1; i < this._nodes.length; i++) {
            if (this._nodes[i].rect.regionId !== lastPlacedRegion) {
              const swap = Util.clone(this._nodes[0]);
              this._nodes[0] = Util.clone(this._nodes[i]);
              this._nodes[i] = swap;
              break;
            }
          }
        }
      }
    } else {
      this._nodes.sort((a, b) => {
        return PackerUtils.larger_tl(a.rect, b.rect);
      });
    }
  }

  /**
   * loop over node set and try to consolidate adjacent nodes
   * @return list of updated (consolidated) nodes
   * @param force
   */
  private consolidateNodes(force: boolean = false): PackerNode[] {
    const updates = [];

    if (this._nodes.length < 2) {
      return updates;
    }

    /* consolidate neighboring unoccupied blocks */
    this._nodes.forEach((node) => { node.dropped = false; });
    const toDrop: Node[] = [];
    this._nodes.sort ((a, b) => {
      return PackerUtils.smaller_tl(a.rect, b.rect);
    });
    let canDoSomething: boolean = true;
    while (canDoSomething) {
      canDoSomething = false;
      for (const i in this._nodes) {
        const node = this._nodes[i];
        let aspect = PackerUtils.noAspect;
        if (! isNullOrUndefined(node.occupiedBy)) {
          aspect = PackerUtils.resolveConstraints(node, this._isMixed, node.rect)._aspect;
        }
        if (!node.dropped && (force || ((isNullOrUndefined(node.occupiedBy) || aspect === PackerUtils.noAspect)))) {
          while (this._consolidate(node, toDrop)) {
            this._nodes.sort((a, b) => {
              return PackerUtils.smaller_tl(a.rect, b.rect);
            });
            updates.push(node);
            canDoSomething = true;
          }
        }
        if (canDoSomething) {
          break;
        }
      }
    }
    toDrop.forEach((n) => {
      this._nodes = _.reject (this._nodes, n);
    });
    this._nodes.sort ((a, b) => {
      return PackerUtils.larger_first(a.rect, b.rect);
    });
    return updates;
  }

  /**
   * look for a consolidation partner for a single node, iteratively until no new consolidations are performed
   * @return consolidated node
   * @param node
   */
  private consolidateSingleNode(node: Node): Node {
    const toDrop: Node[] = [];
    this._nodes.forEach((n) => { n.dropped = false; });
    while (this._consolidate(node, toDrop)) { continue; }
    toDrop.forEach((n) => {
      this._nodes = _.reject (this._nodes, n);
    });
    return node;
  }

  /**
   * perform the consolidation if possible, looking for and checking all neighboring nodes
   * @return true is a consolidation was performed, false otherwise
   * @param node
   * @param dropped
   * @private
   */
  private _consolidate(node: Node, dropped: Node[]): boolean {
    let consolidatedSomething = false;

    for (const n in this._nodes) {
      const neighbor = this._nodes[n];
      if (isNullOrUndefined(neighbor) || ! isNullOrUndefined(neighbor.occupiedBy) || (neighbor.dropped === true)) {
        continue;
      }
      if (neighbor.id === node.id) {
        continue;
      }
      if (neighbor.rect.deviceId !== node.rect.deviceId ||  neighbor.rect.regionId !== node.rect.regionId) {
        continue;
      }
      if (node.rect.width === node.rect.boundingWidth && node.rect.height === node.rect.boundingHeight) {
        /* already full screen */
        continue;
      }

      switch (this.neighboring(node, neighbor)) {
        case "left":
          node.rect.x0 = neighbor.rect.x0;
          node.rect.width += neighbor.rect.width;
          dropped.push (neighbor);
          neighbor.dropped = true;
          break;
        case "right":
          node.rect.width += neighbor.rect.width;
          dropped.push (neighbor);
          neighbor.dropped = true;
          break;
        case "top":
          node.rect.y0 = neighbor.rect.y0;
        case "bottom":
          node.rect.height += neighbor.rect.height;
          neighbor.dropped = true;
          dropped.push (neighbor);
          break;
        case "none":
          continue;
      }
      consolidatedSomething = true;
    }
    return consolidatedSomething;
  }

  /**
   * @returns whether two nodes are adjacent and if so , which leg they share
   * @param n1
   * @param n2
   */
  private neighboring(n1: Node, n2: Node): string {
    if ((n1.rect.y0 === n2.rect.y0) && n1.rect.x0 + n1.rect.width === n2.rect.x0  &&  (n1.rect.height === n2.rect.height)) {
      return "right";
    }
    if ((n1.rect.x0 === n2.rect.x0) && n1.rect.y0 + n1.rect.height === n2.rect.y0  &&  (n1.rect.width === n2.rect.width)) {
      return "bottom";
    }
    if ((n1.rect.y0 === n2.rect.y0) && n1.rect.x0 === n2.rect.x0 + n2.rect.width &&  (n1.rect.height === n2.rect.height)) {
      return "left";
    }
    if ((n1.rect.x0 === n2.rect.x0) && n1.rect.y0 === n2.rect.y0 + n2.rect.height &&  (n1.rect.width === n2.rect.width)) {
      return "top";
    }
    return "none";
  }
}
