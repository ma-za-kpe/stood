# Changelog

## [0.6.0](https://github.com/ma-za-kpe/stood/compare/v0.5.0...v0.6.0) (2026-10-08)


### Features

* **payments:** let a named person resolve a reconciliation finding (T-0257) ([165e6d3](https://github.com/ma-za-kpe/stood/commit/165e6d3b30fb192d2f0d1411bbb24b67784cbe6b))


### Documentation

* **security:** prepare the OpenSSF Best Practices badge answers (T-0258) ([f494c30](https://github.com/ma-za-kpe/stood/commit/f494c30707a7e053d34df27677e1127fe8fe609a))

## [0.5.0](https://github.com/ma-za-kpe/stood/compare/v0.4.1...v0.5.0) (2026-10-08)


### Features

* **payments:** first real PayPal sandbox release and refuse, verified webhooks ([#83](https://github.com/ma-za-kpe/stood/issues/83)) ([f346acd](https://github.com/ma-za-kpe/stood/commit/f346acdebaf73b917749d05633e6ae6513a32d4b))
* **payments:** hold without the buyer via PayPal Vault, nightly sandbox run, secret guard ([#87](https://github.com/ma-za-kpe/stood/issues/87)) ([f1fbb74](https://github.com/ma-za-kpe/stood/commit/f1fbb74e23888a6081f3baa5c9424790b81cc4de))
* **payments:** hourly reconciliation audit, proven idempotency, migrations and TLS on release ([#89](https://github.com/ma-za-kpe/stood/issues/89)) ([7ab68d4](https://github.com/ma-za-kpe/stood/commit/7ab68d4130ad4905d328cb9c794c8a3b6f20e6d4))

## [0.4.1](https://github.com/ma-za-kpe/stood/compare/v0.4.0...v0.4.1) (2026-10-08)


### Fixes

* **sdk:** end every request at the SDK's own deadline ([#70](https://github.com/ma-za-kpe/stood/issues/70)) ([a7fce68](https://github.com/ma-za-kpe/stood/commit/a7fce6854026637042c1b120a43a3d167bae291e))

## [0.4.0](https://github.com/ma-za-kpe/stood/compare/v0.3.0...v0.4.0) (2026-10-08)


### Features

* batch 7 — evidence path, reconciliation audit, pricing disclosure, privacy ([#55](https://github.com/ma-za-kpe/stood/issues/55)) ([6c42523](https://github.com/ma-za-kpe/stood/commit/6c425236b1d89974570a4b3a0eac65a619c05163))
* **yard:** A2A surface, search and public Board stream, notices, previews and remaining fakes ([#54](https://github.com/ma-za-kpe/stood/issues/54)) ([e11901a](https://github.com/ma-za-kpe/stood/commit/e11901a443045e02e8fb88f4b28618b621cd7ee4))
* **yard:** advance pre-credential implementation round ([#46](https://github.com/ma-za-kpe/stood/issues/46)) ([bba9e58](https://github.com/ma-za-kpe/stood/commit/bba9e5841e1c6961cd8669a184aacd291778d8e3))
* **yard:** hold-gated builds, Stood mandate, change orders, operators and reputation ([#53](https://github.com/ma-za-kpe/stood/issues/53)) ([a0395c5](https://github.com/ma-za-kpe/stood/commit/a0395c59508e38a057f46be939a388efc18b4989))
* **yard:** refused, reworked and paid judge path across Stood and Yard ([#47](https://github.com/ma-za-kpe/stood/issues/47)) ([70da339](https://github.com/ma-za-kpe/stood/commit/70da33904d04cd411045f61e242933223c10e0e7))
* **yard:** role-filtered stream, step 9 key screen and planner contract suite ([#52](https://github.com/ma-za-kpe/stood/issues/52)) ([05a632d](https://github.com/ma-za-kpe/stood/commit/05a632d807fd20dedb098e2c97347610ae4dade0))
* **yard:** test-key vault, step 9 intake, handover checklist and Render Blueprint ([#48](https://github.com/ma-za-kpe/stood/issues/48)) ([55e66bb](https://github.com/ma-za-kpe/stood/commit/55e66bb3b2c3c83613a06030fa91f1d53fd27770))


### Fixes

* **build:** give tests more time inside Render's image build ([#64](https://github.com/ma-za-kpe/stood/issues/64)) ([dd605db](https://github.com/ma-za-kpe/stood/commit/dd605db8edfca7d987bb68e322f713f14c5c60df))
* **ci:** build yard-contracts before the Yard web app in the Pages site build ([#68](https://github.com/ma-za-kpe/stood/issues/68)) ([e484627](https://github.com/ma-za-kpe/stood/commit/e4846270f42d38a05ba99fd97532482ded105044))
* **deploy:** Render build fixes and Starter reconciler ([#60](https://github.com/ma-za-kpe/stood/issues/60)) ([9704b43](https://github.com/ma-za-kpe/stood/commit/9704b436af8db56c7ee4cad35fe79255a829c49f))
* **deploy:** start the reconciler with an explicit node runtime ([#67](https://github.com/ma-za-kpe/stood/issues/67)) ([95e76c1](https://github.com/ma-za-kpe/stood/commit/95e76c10862619367f0fc49f400c70a30716ec6f))


### Documentation

* **paypal:** how we use the PayPal AI Toolkit and sandbox MCP ([#56](https://github.com/ma-za-kpe/stood/issues/56)) ([7344a85](https://github.com/ma-za-kpe/stood/commit/7344a859c5c13e1dbeb5bf16ae43abf63c3500f2))
* **paypal:** record how the AI Toolkit and sandbox MCP server are used ([defd64d](https://github.com/ma-za-kpe/stood/commit/defd64d8467b18358d22b0fdec9b73b171ce5cc8))
* **paypal:** record how the AI Toolkit and sandbox MCP server are used ([7344a85](https://github.com/ma-za-kpe/stood/commit/7344a859c5c13e1dbeb5bf16ae43abf63c3500f2))

## [0.3.0](https://github.com/ma-za-kpe/stood/compare/v0.2.0...v0.3.0) (2026-10-05)


### Features

* **core:** scope final usage and establish evidence and Yard contracts ([#32](https://github.com/ma-za-kpe/stood/issues/32)) ([b6acdef](https://github.com/ma-za-kpe/stood/commit/b6acdef6bda6b7cdb71a7979719a3ad8735da8df))
* **demo:** align code milestones, product contracts and judge fixtures ([#30](https://github.com/ma-za-kpe/stood/issues/30)) ([0f9b6bb](https://github.com/ma-za-kpe/stood/commit/0f9b6bb77d4a12644ecb437b4d0b98c3812794a8))
* **mock:** add provider switching and durable Stood scenarios ([#38](https://github.com/ma-za-kpe/stood/issues/38)) ([3c008e0](https://github.com/ma-za-kpe/stood/commit/3c008e0a163a793b019c744a5495466073d72bb8))
* **providers:** add explicit modes and SDK-tested PayPal simulation ([#37](https://github.com/ma-za-kpe/stood/issues/37)) ([e22e086](https://github.com/ma-za-kpe/stood/commit/e22e086937ec3713bfbf2979bd59403c44ddfaf7))
* **yard:** add durable Board, network mock flow and simulated landing page ([#39](https://github.com/ma-za-kpe/stood/issues/39)) ([1f3d5f1](https://github.com/ma-za-kpe/stood/commit/1f3d5f15dc65d5387dc91259b9eb9f52a4dcfede))
* **yard:** establish API, domains, restricted storage and public SDK foundations ([#34](https://github.com/ma-za-kpe/stood/issues/34)) ([823e538](https://github.com/ma-za-kpe/stood/commit/823e5388c94b032e38261aa8f0c08bdd7f92d7e7))


### Documentation

* **tasks:** add Stood, Yard, provider-abstraction and E2E backlog T-0197 to T-0234 ([#35](https://github.com/ma-za-kpe/stood/issues/35)) ([d4fa4db](https://github.com/ma-za-kpe/stood/commit/d4fa4db130de7c09f6f61e34284f155cebda173f))
* **tasks:** record Yard visual quality and simulation messaging ([#36](https://github.com/ma-za-kpe/stood/issues/36)) ([efc3621](https://github.com/ma-za-kpe/stood/commit/efc362176f05a44313c4fe8b8da064bbbe1ec5a6))
* **yard:** add Yard companion product docs ([#31](https://github.com/ma-za-kpe/stood/issues/31)) ([37d2bac](https://github.com/ma-za-kpe/stood/commit/37d2bac5f5639c140c0f10326b94e9a05b66fd97))
* **yard:** design system, brand kit, real-time state, intake, hosting decision, crew contract ([#33](https://github.com/ma-za-kpe/stood/issues/33)) ([e794520](https://github.com/ma-za-kpe/stood/commit/e7945200774781ed80dcd1fd0fab50c067d14f6f))

## [0.2.0](https://github.com/ma-za-kpe/stood/compare/v0.1.0...v0.2.0) (2026-10-05)


### Features

* **core:** add guarded PayPal operations and signed draft API ([#23](https://github.com/ma-za-kpe/stood/issues/23)) ([523c899](https://github.com/ma-za-kpe/stood/commit/523c8994b8d5bc2ace2aef7b841b0f64541282c0))
* **core:** bootstrap Docker and tested decision gate ([#9](https://github.com/ma-za-kpe/stood/issues/9)) ([2854815](https://github.com/ma-za-kpe/stood/commit/2854815efc18328facdd74cff71ce4604be9e806))
* **decision:** enforce model confidence and preserve evidence details ([#10](https://github.com/ma-za-kpe/stood/issues/10)) ([31176e2](https://github.com/ma-za-kpe/stood/commit/31176e2f182211fa5676184faace2157aac60df3))
* **payments:** add durable operation schema and database checks ([#16](https://github.com/ma-za-kpe/stood/issues/16)) ([86ab9f2](https://github.com/ma-za-kpe/stood/commit/86ab9f267cc2076a6261f70dd03ec26a8a9a14cf))
* **payments:** persist operation reservations and outcomes atomically ([#18](https://github.com/ma-za-kpe/stood/issues/18)) ([a62dff4](https://github.com/ma-za-kpe/stood/commit/a62dff4e200f30eaec2bcbac7167e71d696cec2d)), closes [#15](https://github.com/ma-za-kpe/stood/issues/15)
* **payments:** recover tranche state through validated transitions ([#20](https://github.com/ma-za-kpe/stood/issues/20)) ([cd0028b](https://github.com/ma-za-kpe/stood/commit/cd0028bfeb93812acf6164f9942d97e7ce6cd557)), closes [#19](https://github.com/ma-za-kpe/stood/issues/19)
* **payments:** recover, persist and reconcile holds safely ([#21](https://github.com/ma-za-kpe/stood/issues/21)) ([f5020ec](https://github.com/ma-za-kpe/stood/commit/f5020ec0480c285cdaeacba8d62d2894f1eb7abd))
* **payments:** reserve day-four reauthorisation safely ([#13](https://github.com/ma-za-kpe/stood/issues/13)) ([c3cc338](https://github.com/ma-za-kpe/stood/commit/c3cc338237638e928725f5ee6e8101ed77ef8c76)), closes [#12](https://github.com/ma-za-kpe/stood/issues/12)
* **payments:** validate allowance currency and capture safety policies ([#11](https://github.com/ma-za-kpe/stood/issues/11)) ([82e5e25](https://github.com/ma-za-kpe/stood/commit/82e5e25a3e71c087e5937a64edfb17e0bfec1380))
* **site:** reposition landing page on agent-to-agent payments ([#24](https://github.com/ma-za-kpe/stood/issues/24)) ([9eebf39](https://github.com/ma-za-kpe/stood/commit/9eebf392deb92b6d9d71a85c99ecc22743225b34))


### Fixes

* **payments:** enforce forward ledger history and server timestamps ([#17](https://github.com/ma-za-kpe/stood/issues/17)) ([1056457](https://github.com/ma-za-kpe/stood/commit/10564571505b03587a1d10b0e30166101bb58247)), closes [#15](https://github.com/ma-za-kpe/stood/issues/15)


### Documentation

* **payments:** track onboarding and reconciliation prerequisites ([#14](https://github.com/ma-za-kpe/stood/issues/14)) ([994b47f](https://github.com/ma-za-kpe/stood/commit/994b47f063677f11c8b1de78c56e5cb45138233f))

## 0.1.0 (2026-10-03)


### Features

* foundation docs, Volt brand, landing page and quality gate ([61598f8](https://github.com/ma-za-kpe/stood/commit/61598f8fe74feceedb2d121084f309558d0e4b65))
