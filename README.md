<p align="center">
  <img src="https://2immerse.eu/wp-content/uploads/2016/04/2-Immerse_Joined_Linear_Colour_Smallerlogo.png" width="200"><br>
  <strong>Layout Service</strong>
</p>

Getting Started
---------------

The recommended way to run the 2Immerse Layout Service is to use the prebuilt docker images:

```
docker run -p 3000:3000 layout-service:latest
```

Contributing
------------

The Layout Service is a [NodeJS](https://nodejs.org/en/) express application using RAML to define a RESTful API.

The project takes advantage of the modern features provided by [ES6](http://www.ecma-international.org/ecma-262/6.0/) and uses [TypeScript](https://www.typescriptlang.org/) to enhance maintainability and to aid developers.

#### Requirements

 * NodeJS - 8.x+

#### Dependencies

[Yarn](https://yarnpkg.com) is used to manage fixed dependencies. First install Yarn then install the dependencies:

```
yarn install
```

*N.B. If you don't want to install Yarn you can still use NPM to install the required packages however package compatibility cannot be guarunteed.*

#### Running

Because the project uses TypeScript the codebase needs transpiling to JavaScript before the NodeJS application can be run.

To transpile the code into javascript use:

```
gulp scripts
```

There are 2 Yarn tasks for building and running the code in 1 go:

```
yarn run start
```

If you want to test locally with only the Layout Service running you should use:

```
yarn run test
```

**N.B. you will need a locally running MongoDB instance**

#### Strict mode

Strict mode is on. This means all scripts will be generated in strict mode and also any unused variables will be flagged during transpile time.

Make use of TypeScript features to avoid this, if an argument must be parsed then prefix the variables with ```_```.

```
router.get('/context', (req: Request, res: Response) => { });
```

*becomes:*

```
router.get('/context', (_req: Request, _res: Response) => {});
```

#### Code style

Some notes on preferred code style:

 * Use fat arrow functions!
   Fat arrow functions will maintain context and are easier to read. i.e. ```this``` will always refer to the parent object scope rather than the current function scope.
 * Use ```Object.forEach``` rather than ```for(...)```.
 * Make good use of optionals. TypeScript allows arguments to be specified as optional: ```(req?: Request)```.
 * Never use ```null```! TypeScript doesn't have a concept of null, neither does Javascript really. Either check for a truthly value ```if (!err)``` or check for ```undefined```.
 * Expand ifs. Easier to read and follow, size doesn't matter.
 * Use interfaces. TypeScript allows interfaces to be used to hint argument types.
 * Don't export everything, only export classes you need to use in another file
 * DRY. Make use of Utility classes and static methods to provide shared tools.
 * Use constructors to assign. ES6 classes have constructors and TypeScript allows private variables to assign directly to class properties:

```
class Test {
 constructor(private world: string) { }

 public hello() {
   return 'hello' + this.world;
 }
}

let test = new Test('world');
console.log(test.hello()); // hello world
```

Datastore ORM
-------------

This project has moved to storing it's data in MongoDB and uses the [Iridium](https://github.com/SierraSoftworks/Iridium) library to manage connections and entities.

See *src/model/Context.ts* and */src/controllers/ContextController.ts* for examples of creating entities and manipulating them.

Promises
--------

Method should avoid using callbacks and promises should be used instead. Because the project uses ES6 native support for Promise is included in the form of the ```Promise``` object.

Documentation
-------------

There are both API documentation and generated type documentation available. This REST API documentation can be [viewed online](https://origin.platform.2immerse.eu/docs/layout-service/latest/).

All methods and parameters must have documentation comments. However don't use standard jsdoc style use TypeScript doc blocks. Because TypeScript provide type hinting the documentation generator uses this information to generate valid documentation and developer added doc blocks are used to add additional comments and hints.

**DO THIS**

```
/**
 * Prints out hello world
 *
 * @param world - specify word
 * @returns concatenated phrase
 */
public hello(world: string): string {
  return 'hello ' + world;
}
```

**NOT THIS**
```
/**
 * Prints out hello world
 *
 * @class Test
 * @param {string} world - specify word
 * @returns {string} - concatenated phrase
 */
public hello(world: string): string {
  return 'hello ' + world;
}
```

**More information about [TypeDoc](http://typedoc.org/) syntax can be [found here](http://typedoc.org/guides/doccomments/)**

To generated documentation you will first need to install both the dev and prod dependencies. You will also need [gulp](http://gulpjs.com/).

```
yarn global gulp
yarn install
```

This will generate the documentation in the ```docs/``` folder

```
gulp docs
```



## Licence and Authors

All code and documentation is licensed by the original author and contributors under the Apache License v2.0:

* Cisco an/or its affiliates

<img src="https://2immerse.eu/wp-content/uploads/2016/04/2-IMM_150x50.png" align="left"/><em>This project was originally developed as part of the <a href="https://2immerse.eu/">2-IMMERSE</a> project, co-funded by the European Commission’s <a hef="http://ec.europa.eu/programmes/horizon2020/">Horizon 2020</a> Research Programme</em>

See AUTHORS file for a full list of individuals and organisations that have
contributed to this code.
