+++
title = "Layout Requirements Document Format"
weight = 2
+++
Version 3

The layout requirements document will specify for each media object/DMApp component within the DMApp, layout constraints that will be taken into account by the layout service whenever layout is evaluated.

We expect this data model to develop / evolve through the project.

Example:

```json
{
	"version": 3,
	"dmapp": "TheatreAtHomev1.0",
	"timelineDocUrl": "timeline.xml",
	"constraints": [{
		"constraintId": "componentC",
		"personal": {
			"audio": true,
			"touchInteraction": false,
			"aspect": "3:4",
			"prefSize": {
				"width": 1920,
				"height": 1080
			},
			"minSize": {
				"width": 600,
				"height": 800
			},
			"targetRegions": [
				"tab1", "tab2"
			],
			"margin": 2,
			"priority": 3,
			"anchor": ["center"],
			"componentDependency": ["componentA", "componentB"],
			"componentDeviceDependency": "componentA",
			"logicalRegions": [
				{
					"regionId": "lowerThird",
					"position": {
						"x": 0,
						"y": 0.66
					},
					"size": {
						"width": 1.0,
						"height": 0.33
					}
				}
			]
		},
		"communal": {
			"audio": true,
			"touchInteraction": false,
			"aspect": "3:4",
			"prefSize": {
				"width": 600,
				"height": 800
			},
			"minSize": {
				"width": 600,
				"height": 800
			},
			"targetRegions": [
				"main"
			],
			"margin": 10,
			"priority": 10,
			"anchor": ["top", "left", "center", "right", "bottom"],
			"dependency": ["componentA"]
		}
	}],
	"layoutModel": "template",
	"templates": [{
		"deviceType": "default",
		"htmlUrl": "http://origin.2immerse.advdev.tv/sandbox/template-default.html",
		"layout": {
			"portrait": [{
				"region": {
					"id": "region-0",
					"position": {
						"x": 0,
						"y": 0
					},
					"size": {
						"width": 1.0,
						"height": 1.0
					}
				}
			}],
			"landscape": [{
				"region": {
					"id": "region-0",
					"position": {
						"x": 0,
						"y": 0
					},
					"size": {
						"width": 1.0,
						"height": 1.0
					}
				}
			}]
		}
	}]
}
```

where

* timelineDocUrl is a url to the timeline document to be passed to and loaded by the timeline service; it is either an absolute url, or, relative to the layoutReqsUrl url passed to the layout service in the load DMApp call.
* constraints is a array of per-component layout constraints, and
* component constraints are defined as a pair; one set that applies when the component is laid out on a personal device, and one that applies when the component is laid out on a communal device (whether a device is personal or communal is defined when the device joins a context). This allows authors to assign a component different priorities for presentation on communal & personal devices respectively.
* high priority values take priority over low values, a value of 0 means 'hidden' (i.e. don't include in layout)
* if aspect is present, it must be preserved
* minSize determines the minimum size a component should be presented at; if this constraint cannot be met the component will not be laid out
* minSize determines the preferred size a component should be presented at; if this preference cannot be met the component may still be laid out (subject to other constraints)
* targetRegions is an optional list of regions into which the component should be placed, defined in order of preference.
* anchor is a list of values in { top, bottom, left, right }
* componentDependency is a list of component IDs upon which this component is dependent (i.e, myComponentID will be displayed only if componentA and componentB are active). These components must have a higher priority i.e. componentA & componentB priorities must be higher than that of myComponentID.
* componentDeviceDependency is a list of component IDs upon which this component is dependent, and for which this component can only be laid out on the same device as the dependent components. These components must have a higher priority i.e. componentA & componentB priorities must be higher than that of myComponentID.
* logicalRegions is an optional list of logical regions defined relative to the component, into which other components may be laid out (effectively overlaying components over this component). These logical regions are inherently resizable, and will be scaled to reflect the current size of the component. Ordering of logical regions in this list reflects their z-order, the last item in the list is on top. Note that if this dmapp component is not laid out, then components that were previously laid out into it's logical regions will be laid out into other candidate regions or not at all.
* there exists a constraint definition per dmapp component defined in the corresponding timeline document and initialised using the transaction API NB - if an unknown dmapp component is initialised, the layout service will assume a set of minimal default constraints.
* we may support multiple layoutModels; currently "template" & "dynamic" are defined
* When layoutModel is "template":
 * there needs to be at least a "default" template defined
 * each template layout can be defined by a included json object ('layout'), or via a url to an html document
 * each region in a template (json or html) has an id of the form "region-x", where x is an integer starting at 0
 * at least one landscape or portrait templates need to be defined, but if the device supports orientation change, then both must be defined.
 * region positions & sizes are specified as "number" types with values from 0 to 1 inclusive (to give a degree of actual device resolution independence...)
 * device types include: "default", "tv", "tablet", "mobile"
* When layoutModel is "dynamic":
 * the layout service assumes responsibility for determining size and position of all components