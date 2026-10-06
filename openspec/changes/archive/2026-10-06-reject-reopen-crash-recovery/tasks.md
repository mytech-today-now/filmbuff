## 1. Contract and design

- [x] 1.1 Define an additive append-only intent and operation marker contract.
- [x] 1.2 Specify recoverable clip-path states, safe rollback, and fail-closed conflicts.

## 2. Implementation

- [x] 2.1 Add typed lifecycle markers and reconcile them under the existing status-file lock.
- [x] 2.2 Route reject and reopen through the recoverable protocol and prevent archive replacement.

## 3. Verification

- [x] 3.1 Add interruption and baseline coverage for reject and reopen.
- [x] 3.2 Run the full unit suite and relevant CLI lifecycle tests.
- [x] 3.3 Validate the OpenSpec change and review the final diff.
