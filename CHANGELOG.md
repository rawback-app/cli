# Changelog

## [1.0.9](https://github.com/rawback-app/cli/compare/v1.0.8...v1.0.9) (2026-08-30)


### Features

* **album:** add album refresh command ([ac60c1b](https://github.com/rawback-app/cli/commit/ac60c1bedd7b6ca42964b45486427a2bf3b98ffc))
* **album:** add album refresh command ([e533a4d](https://github.com/rawback-app/cli/commit/e533a4d287fbe072425527dee66eb4cc3632bd23))
* **app:** upgrade based packages to latest ([1c49fa5](https://github.com/rawback-app/cli/commit/1c49fa58fe06225383112c9caba3005894c55641))
* **camera:** add connect, list, use, forget, info, and status ([1ba7b41](https://github.com/rawback-app/cli/commit/1ba7b418f3bb988d88743aa81c20cdae7b4e199f))
* **camera:** add live view and event streaming ([f115b17](https://github.com/rawback-app/cli/commit/f115b17b4a73e9ec96c00f8195920de3d3054f69))
* **camera:** add shoot, settings, and contents commands ([cb3a115](https://github.com/rawback-app/cli/commit/cb3a1158d8b36fbace1c3d6ed0c3d36fcd9fdc0f))
* **camera:** add the CCAPI session layer ([e2a22c7](https://github.com/rawback-app/cli/commit/e2a22c70ae0a11a0173402a65831c3b1ba277767))
* **camera:** add the endpoint registry and generic api runner ([451b14e](https://github.com/rawback-app/cli/commit/451b14e63adb625add6f61a6880091f62396e953))
* **camera:** add the interactive endpoint explorer ([3364b5c](https://github.com/rawback-app/cli/commit/3364b5cbec43ea9a8c4a3d065b215ab22adf8560))
* **camera:** control a Canon camera over CCAPI ([367f7e3](https://github.com/rawback-app/cli/commit/367f7e361091cb707edba0498715958fa11c3cb0))
* **camera:** store saved cameras in ~/.rawback/cameras.json ([0a331c7](https://github.com/rawback-app/cli/commit/0a331c74e689974339dd288fe4953c4358d6420c))
* **cli:** add a memory command ([a19aee4](https://github.com/rawback-app/cli/commit/a19aee4ddd5131640318ad19eb0eb95d33cef8a7))
* **cli:** add a memory command ([f39a337](https://github.com/rawback-app/cli/commit/f39a33759af38c675501d5172ad88f303c59a797))
* **photos:** add `rawback photos search` for plain-language search ([3393787](https://github.com/rawback-app/cli/commit/33937875e099eceb27863906a8f412613c5adb8f))
* **photos:** add `rawback photos search` for plain-language search ([1cd211c](https://github.com/rawback-app/cli/commit/1cd211cb1e4fb0be45b5fefa45364fcad6587648))
* **video:** probe, cut a poster frame and split audio before upload ([4b19807](https://github.com/rawback-app/cli/commit/4b19807d52ae3810d37c72b26b64c7bd43d2b826))
* **video:** probe, cut a poster frame and split audio before upload ([aef4f30](https://github.com/rawback-app/cli/commit/aef4f3051bb1b7750bf1f2bd008f2fdcdc8473da))


### Bug Fixes

* **docs:** correct the SFTP endpoint port to 23168 ([f9cf8f9](https://github.com/rawback-app/cli/commit/f9cf8f9e03d0cbbd7454001e9ae7572993e46342))
* **docs:** correct the SFTP endpoint port to 23168 ([aafeeb9](https://github.com/rawback-app/cli/commit/aafeeb9b10f2d8ed79fff7524ccd7a167a9e979d))


### Documentation

* **camera:** document camera control and the shared connection file ([042fb46](https://github.com/rawback-app/cli/commit/042fb4698b66cf67664058d0bac8d4b77c626530))


### Tests

* **camera:** assert the store round-trips with Rawback Desktop ([ec911cb](https://github.com/rawback-app/cli/commit/ec911cb4883dff8464da42fb90a3111afbab2e57))


### Miscellaneous

* **ci:** upgrade bun to 1.4.0 ([df3ad0f](https://github.com/rawback-app/cli/commit/df3ad0fbf7efb897c56ead62ab00192b01b56dbd))
* **ci:** upgrade bun to 1.4.0 ([755c19e](https://github.com/rawback-app/cli/commit/755c19e1bc2bd7db83f55d882bdd49ece7965604))
* **deps:** resolve @rawback/sdk 0.2.7 in the lockfile ([cc5992c](https://github.com/rawback-app/cli/commit/cc5992c0569336ad478ed0ab13ac2e5951bc154a))

## [1.0.8](https://github.com/rawback-app/cli/compare/v1.0.7...v1.0.8) (2026-08-04)


### Features

* **config:** add metadata concurrency override ([72312e4](https://github.com/rawback-app/cli/commit/72312e4a311414add14049d6a45517d263c94d96))
* **config:** add metadata concurrency override ([d3ccc20](https://github.com/rawback-app/cli/commit/d3ccc20901f39764b4f211e307b662308f686140))
* **errors:** show the request trace ID on every command failure ([034b8aa](https://github.com/rawback-app/cli/commit/034b8aa01d13b9617fe5f8c6cf19b8840eb66695))
* **errors:** show the request trace ID on every command failure ([a887699](https://github.com/rawback-app/cli/commit/a88769934b2100ebaba780b2beb81a2a98253002))
* **videos:** add videos command ([4ba51e4](https://github.com/rawback-app/cli/commit/4ba51e42dd07584af9f34608677d7faeee45491f))
* **videos:** add videos command ([de48bed](https://github.com/rawback-app/cli/commit/de48bed4fcc6615ff8891b1d4e64568826288cac))


### Bug Fixes

* **ci:** grant Claude workflows write access to PRs and issues ([3d1a094](https://github.com/rawback-app/cli/commit/3d1a094ef3c11eca7475d4a6828c907e05c46016))
* **ci:** grant Claude workflows write access to PRs and issues ([5ac1947](https://github.com/rawback-app/cli/commit/5ac194708ac32702168d2c19f1b5eb0dd076b982))
* **ci:** use /claude as the Claude Code workflow trigger ([3526ec4](https://github.com/rawback-app/cli/commit/3526ec432ab736cc01be7f24ec4053931dd15ff1))
* **ci:** use /claude as the Claude Code workflow trigger ([2138e13](https://github.com/rawback-app/cli/commit/2138e13bfed409614ee2c3b33314428e91c3f380))
* **deps:** pin the SDK version release-please actually publishes ([fac630a](https://github.com/rawback-app/cli/commit/fac630acf7f1613ea8621d7db6c0a0a8b90232c3))
* **videos:** never upload zero-padded parts, and close the thumbnail handle ([3190938](https://github.com/rawback-app/cli/commit/319093820ca7bc70b1b9bbf85a522ec3e6229649))


### Performance Improvements

* **cli:** keep the SDK off the startup path ([ae94f82](https://github.com/rawback-app/cli/commit/ae94f822411823370905619f67d73d1e6867b9d2))


### Miscellaneous

* **deps:** install @rawback/sdk 0.2.5 ([8d530bf](https://github.com/rawback-app/cli/commit/8d530bfc2c8966e1a1a77ec5416913c6ad3bbdec))
* **deps:** update @rawback/sdk to 0.2.6 ([c752b9e](https://github.com/rawback-app/cli/commit/c752b9e80b4a99afeb43b2b20e13c5b66f6c9818))
* **deps:** update @rawback/sdk to 0.2.6 ([2f27a06](https://github.com/rawback-app/cli/commit/2f27a06713ee444466ac6e7222ad0488ef69acd0))

## [1.0.7](https://github.com/rawback-app/cli/compare/v1.0.6...v1.0.7) (2026-08-01)


### Features

* show progress for photo checks ([6564e44](https://github.com/rawback-app/cli/commit/6564e4496121db47117219dacd319a3c111749b2))


### Performance Improvements

* **uploads:** size SFTP channels from concurrency ([c2c14af](https://github.com/rawback-app/cli/commit/c2c14afc76ba340a396b7cbd2232b1f81167d47c))
* **uploads:** size SFTP channels from concurrency ([d98682a](https://github.com/rawback-app/cli/commit/d98682ac74a2ef6d5c904f892278a3cd473fe750))


### Documentation

* **uploads:** document adaptive metadata extraction ([#40](https://github.com/rawback-app/cli/issues/40)) ([c0d820b](https://github.com/rawback-app/cli/commit/c0d820b0d1e569a9ec3226e39c988466b1d5536e))


### Build System

* **deps:** update rawback sdk to 0.2.2 ([9b04b5f](https://github.com/rawback-app/cli/commit/9b04b5fe0484b0e44990dd9c9441009e391c7db5))
* **deps:** update rawback sdk to 0.2.2 ([9e47d6b](https://github.com/rawback-app/cli/commit/9e47d6b25a227562414277fd1496c520f9b84d20))
* **deps:** update rawback sdk to 0.2.3 ([54c2430](https://github.com/rawback-app/cli/commit/54c2430b47089ffc64083096f634d127bc7e2e1e))
* **deps:** update rawback sdk to 0.2.3 ([ca89a88](https://github.com/rawback-app/cli/commit/ca89a88fb35e00236e25c9785497b3f471a07c0b))

## [1.0.6](https://github.com/rawback-app/cli/compare/v1.0.5...v1.0.6) (2026-08-01)


### Features

* add local photo duplicate check ([f105fd5](https://github.com/rawback-app/cli/commit/f105fd50ffba9e7d77ca64272c8817502880682b))
* add local photo duplicate check ([6826f9d](https://github.com/rawback-app/cli/commit/6826f9d3e5aa1ad44784b8d772a9ade731b67796))


### Miscellaneous

* **deps:** update sdk to 0.2.1 ([78b12fa](https://github.com/rawback-app/cli/commit/78b12fa8492cb4b884c4d26c6713032154799b44))
* **deps:** update sdk to 0.2.1 ([b37c427](https://github.com/rawback-app/cli/commit/b37c42708a50c4a3a88ce955e5d77dd79a15ef9c))
* ignore generated GraphQL files ([13bc091](https://github.com/rawback-app/cli/commit/13bc0917fa2ea7ab725001d04402b30732c192df))

## [1.0.5](https://github.com/rawback-app/cli/compare/v1.0.4...v1.0.5) (2026-08-01)


### Features

* add identity-aware upload deduplication ([a6b9652](https://github.com/rawback-app/cli/commit/a6b96521788edc8555b028499f35966aad9da04d))
* add identity-aware upload deduplication ([c97a6c7](https://github.com/rawback-app/cli/commit/c97a6c797e47b14325510848df1aefbaed8c6e96))
* **uploads:** identify CLI SFTP sessions ([a1fb82a](https://github.com/rawback-app/cli/commit/a1fb82ab03fd8fb2a008e7da9a9358a984b5c154))
* **uploads:** identify CLI SFTP sessions ([bcb4590](https://github.com/rawback-app/cli/commit/bcb45906b2ed919da05736115d32970cae7f4fd9))


### Code Refactoring

* prefer Bun native APIs ([a8a7da3](https://github.com/rawback-app/cli/commit/a8a7da3da18089e072635fde228b5a2fce9e4793))
* prefer Bun native APIs ([c36ebba](https://github.com/rawback-app/cli/commit/c36ebba90eebe99e763c67574768d4b7abd05ae3))


### Miscellaneous

* **deps:** update SDK to 0.1.2 ([2abb69b](https://github.com/rawback-app/cli/commit/2abb69b743c2d8db764c2480b9015d035a36a3d5))
* **deps:** update SDK to 0.1.2 ([f4c7e67](https://github.com/rawback-app/cli/commit/f4c7e67b9c49094e6ba893736b1bc24c80a5aa69))
* **deps:** update SDK to 0.2.0 ([93cc4cc](https://github.com/rawback-app/cli/commit/93cc4ccffb3a32ad6962f066b4313c2ece08f92d))
* **deps:** update SDK to 0.2.0 ([70369db](https://github.com/rawback-app/cli/commit/70369db49747f5eb1e6f73072a15681789634448))

## [1.0.4](https://github.com/rawback-app/cli/compare/v1.0.3...v1.0.4) (2026-07-30)


### Code Refactoring

* adopt shared Rawback SDK ([d466f56](https://github.com/rawback-app/cli/commit/d466f56b30425e16719ba07296caf66f2774662f))
* adopt shared Rawback SDK ([637c52b](https://github.com/rawback-app/cli/commit/637c52bafeaf5182defd1676df27ae0836f6ad99))

## [1.0.3](https://github.com/rawback-app/cli/compare/v1.0.2...v1.0.3) (2026-07-28)


### Features

* add read-only config viewer ([26add9a](https://github.com/rawback-app/cli/commit/26add9a215b9336d45f023ee3c6539a0d67e6c51))
* add read-only config viewer ([d2da3b8](https://github.com/rawback-app/cli/commit/d2da3b83e00bc61ad0708696019defdb21c631d9))


### Bug Fixes

* clear completed activity indicators ([a7cc5a3](https://github.com/rawback-app/cli/commit/a7cc5a312eb6f3c8c8a4f2dd50718a85d4a174dd))
* clear completed activity indicators ([6573bcc](https://github.com/rawback-app/cli/commit/6573bcc179d4cb8b4331860d6584c4fadbd73556))

## [1.0.2](https://github.com/rawback-app/cli/compare/v1.0.1...v1.0.2) (2026-07-27)


### Bug Fixes

* report device auth failures ([b3de0f3](https://github.com/rawback-app/cli/commit/b3de0f35d5c849603607ab0124553f1c99de8114))
* report underlying device auth failures ([fc70db2](https://github.com/rawback-app/cli/commit/fc70db2dced1320a0f0a824c6d71e3b4f981d275))
* retry device authentication setup ([bf66500](https://github.com/rawback-app/cli/commit/bf665003bbca720251dc4055f93917b76c8dfd70))
* retry unavailable device authentication ([b2ef335](https://github.com/rawback-app/cli/commit/b2ef335095556f1bf58f4e07f345a0197b280359))

## [1.0.1](https://github.com/rawback-app/cli/compare/v1.0.0...v1.0.1) (2026-07-27)


### Bug Fixes

* **fmt:** fmt code ([ac6dc65](https://github.com/rawback-app/cli/commit/ac6dc65ad2ee1deb1af4874b85ef934f42f26f2e))
* **fmt:** fmt code ([0878f93](https://github.com/rawback-app/cli/commit/0878f939208cd35ed9e203cc68715d15672b918e))


### Continuous Integration

* skip native Windows jobs ([17a592c](https://github.com/rawback-app/cli/commit/17a592ca4f407fac0bb7481c575145b8287b17fa))
* skip native Windows jobs ([ed35a33](https://github.com/rawback-app/cli/commit/ed35a3376d70b1e2255948c6ff0d45372061b39d))

## 1.0.0 (2026-07-27)


### Features

* add album and article commands ([7008078](https://github.com/rawback-app/cli/commit/700807897a7927f290bbaadee0bf88d7662be583))
* add album and article commands ([490340f](https://github.com/rawback-app/cli/commit/490340f0013f6e6246f1932bff89330f2f47c602))
* add API client foundation ([604d2c9](https://github.com/rawback-app/cli/commit/604d2c99113413eee6a96e35aa7245584878d97e))
* add API client foundation ([3f280a7](https://github.com/rawback-app/cli/commit/3f280a76c224212572d23becd8f23bcaf8a745a9))
* add auth commands ([2f41db9](https://github.com/rawback-app/cli/commit/2f41db911e81ec016fb526f21bf784d39f6e23f8))
* add cross-platform release pipeline ([edc749a](https://github.com/rawback-app/cli/commit/edc749aee469b78200cbc3b861c20b5fda09fb44))
* add cross-platform release pipeline ([271cdd1](https://github.com/rawback-app/cli/commit/271cdd1d7665f96ab92e411e8f9e11cbc631b704))
* add device authentication flow ([176fd0b](https://github.com/rawback-app/cli/commit/176fd0bab829739c082ba384c960502f1acfbb60))
* add dream commands ([3cae433](https://github.com/rawback-app/cli/commit/3cae433cee1f504b115dec2b763315ee4872bf48))
* add dream commands ([bf3a4bb](https://github.com/rawback-app/cli/commit/bf3a4bb0aed0942080a47c4167d2ca11c4fa0407))
* add Ink terminal UI ([2cd402b](https://github.com/rawback-app/cli/commit/2cd402b9572fb1e27ac783bcd47433d0dba351e5))
* add Ink terminal UI ([93cc470](https://github.com/rawback-app/cli/commit/93cc4709430123318a73b033b4eb59ad7849bc02))
* add SFTP credential commands ([70106f8](https://github.com/rawback-app/cli/commit/70106f89e0704a34d71adce4f988cc88e5f3d423))
* add SFTP credential commands ([b9cc282](https://github.com/rawback-app/cli/commit/b9cc282a05464a3caccbe96f14cd118b0b399e2c))
* add shares command suite ([0bfbc3f](https://github.com/rawback-app/cli/commit/0bfbc3fabe0306b50bfbfdbb802760d1991604bb))
* add shares command suite ([c079056](https://github.com/rawback-app/cli/commit/c079056d8930e1965767db71e3b33b08e1193adb))
* align upload image and RAW formats ([141e333](https://github.com/rawback-app/cli/commit/141e333db8555d8e0b3b1f8586c1be55a57e0276))
* align upload image and RAW formats ([ee30b50](https://github.com/rawback-app/cli/commit/ee30b50b7fac06ab650f0489e6bdd9a3c3780b21))
* initialize Bun CLI ([516f561](https://github.com/rawback-app/cli/commit/516f5618b869a9fdf75e96417776d3d069c1bd31))
* replace password login with device flow ([b8a2ae8](https://github.com/rawback-app/cli/commit/b8a2ae8b71a3f9caca6fe4e24b63fee25bff4d4f))


### Bug Fixes

* always generate SFTP credential passwords ([1d85020](https://github.com/rawback-app/cli/commit/1d85020f71ef2ffa9ef6ee6be07229d6b6138fb5))
* **gql:** update gql schema ([94c9f10](https://github.com/rawback-app/cli/commit/94c9f10c000786f4bb544bc115883efd369ca5e4))
* use compatible Windows checksum hashing ([c1bfebc](https://github.com/rawback-app/cli/commit/c1bfebcc8f21d2137aecf5a4a87d655217787cf1))
* use compatible Windows checksum hashing ([dd1ae82](https://github.com/rawback-app/cli/commit/dd1ae82d50778c4abd041d141241a7ba28afdbbc))


### Documentation

* improve CLI documentation ([156eabf](https://github.com/rawback-app/cli/commit/156eabf7a2b118d9cdc83742b8b05ddcb6395812))
* improve CLI documentation ([86e9c1b](https://github.com/rawback-app/cli/commit/86e9c1b47428198dd4bf6508cb9f18a8fe41fa8b))


### Build System

* ignore generated GraphQL client ([5127628](https://github.com/rawback-app/cli/commit/51276281e09f131ef01503351936ceeb474afb65))
