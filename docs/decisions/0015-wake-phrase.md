# 0015 — Wake phrase: "Hey Atlas"

- Date: 2026-05-12
- Status: Accepted (probationary — re-test after Day 3 of Phase 0.D)

## Context

Wake phrase quality is dominated by two metrics: false-positive rate (FPR) in real-world ambient noise and true-positive rate (TPR) across speaker variation. Two-syllable phrases with a hard consonant (plosive or fricative) outperform single words. Phrases that overlap with everyday speech ("computer", "okay") have high FPR.

"Hey Atlas" matches the working name, has the right phonetics (front-vowel + hard /t/), and is unlikely to be embedded in casual speech.

## Decision

Wake phrase = **"Hey Atlas"**. Custom .ppn files trained via Picovoice Console per platform.

## Consequences

- Wake phrase ties to the working name; a name change forces a wake-word retrain.
- Day 3 of Phase 0.D logs FPR over 8h ambient + TPR over 50 trials; if numbers fail, swap.

## Recovery

Alternative phrases tested first if FPR > 5/8h or TPR < 90%: "Hey Beacon", "Hey Sentinel", "Hey Northstar". Each is one Picovoice Console retrain + binary rebuild. Roll out via auto-update.
