# S04: Job story and the three outcomes

## Job story

> **When** a stage of my build is said to be finished, **I want** the money for it to move only if someone independent stood on my plot and the photos match what I signed for, **so that** I never pay for a wall that isn't there, and when something goes wrong I have a file instead of an argument.

## Lifecycle [C, adds the money model from [09](../09-stood.md)]

```
Allowance signed ──► Stage dispatched ──► Package submitted ──► Decision
   (Vault mandate)    (PayPal AUTHORIZE:      (evidence)          ├─ Release ─► CAPTURE
                       "in review")                               ├─ Refuse  ─► VOID
                                                                  └─ Wait    ─► reviewer ─► Release / Refuse
                                                    Release ─► (later) Dispute ─► packet
```

## The allowance (input, signed once)

Plot (coordinates plus tolerance radius), stages (name, amount, currency), payee (the platform merchant), required shots per stage (angles, checklist items), inspection window, the max number of re-submits, and who may dispute. Signed by Ama, and maps to the **AP2 intent mandate**.

## Outcome 1: Release

| | |
|---|---|
| **Inputs** | A package passes every rule. Model findings are above the confidence threshold |
| **Stood does** | Captures the authorisation for this tranche |
| **Outputs** | Decision = release, capture id, the evidence hashes, a receipt link. Event to the platform: pay the builder's draw and the inspector fee locally |
| **PayPal stores** | Order with `custom_id` = decision id, and a description stating that an agent captured it under allowance X. Capture id |
| **Ama reads** | "Foundation released. £4,000 paid. Kojo stood on the plot at 10:42." |

## Outcome 2: Refuse

| | |
|---|---|
| **Inputs** | Any **hard** rule fails: plot outside tolerance, photo reused, required shot missing, stage clearly wrong |
| **Stood does** | Voids the authorisation. Nothing is captured |
| **Outputs** | Decision = refuse, **the named field**, the evidence. Event to the platform: re-dispatch allowed or not |
| **PayPal stores** | Voided authorisation, with the reference |
| **Ama reads** | "Wrong plot. 1.4 km off. Nothing was paid." |
| **Kojo reads** | "Photos were taken 1.4 km from the plot. Go back to the pin and capture again. Fee not paid for this visit." |

## Outcome 3: Dispute

| | |
|---|---|
| **Inputs** | Ama says a release was wrong |
| **Stood does** | Builds the packet: the allowance she signed, the package that passed (photos, coordinates, times, nonce), the rule results, the model findings, capture id, timeline |
| **Outputs** | A packet ready to file (PDF plus JSON). In sandbox, submitted through the PayPal disputes flow if the sandbox supports it, **otherwise shown as ready to file, never as a fake win** |
| **PayPal stores** | Dispute evidence on the capture |

## Wait (not an outcome, a state) [C]

Used only when the model is unsure (blurred photos, can't tell the stage) or a system fails (PayPal timeout). It **never** turns into a refusal on its own. A human reviewer decides within the authorisation honour period, or Stood reauthorises.
