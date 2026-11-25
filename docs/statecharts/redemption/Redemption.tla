---- MODULE Redemption ----
EXTENDS Naturals
CONSTANTS Starts, Cost, InitStock
VARIABLES start, state, redeemable, stock, debits, refunds, autoApprove, webhooks
vars == <<start, state, redeemable, stock, debits, refunds, autoApprove, webhooks>>

Held == {"pending", "approved", "fulfilled"}
Init == /\ start \in Starts /\ state = "none" /\ redeemable = start /\ stock = InitStock
        /\ debits = 0 /\ refunds = 0 /\ autoApprove \in BOOLEAN /\ webhooks = 0

\* S50/S52: debit + reserve stock atomically; auto-approval skips pending
MemberRedeems == /\ state = "none" /\ redeemable >= Cost /\ stock > 0
                 /\ state' = IF autoApprove THEN "approved" ELSE "pending"
                 /\ redeemable' = redeemable - Cost /\ stock' = stock - 1
                 /\ debits' = debits + 1 /\ webhooks' = webhooks + 1
                 /\ UNCHANGED <<start, refunds, autoApprove>>
\* S50: refused when not enough units or no stock
MemberIsRefused == /\ state = "none" /\ (redeemable < Cost \/ stock = 0)
                   /\ state' = "refused" /\ UNCHANGED <<start, redeemable, stock, debits, refunds, autoApprove, webhooks>>
ApproverApproves == /\ state = "pending" /\ state' = "approved" /\ webhooks' = webhooks + 1
                    /\ UNCHANGED <<start, redeemable, stock, debits, refunds, autoApprove>>
\* S51: refund + stock release in the same transaction as the state change
ApproverRejects == /\ state = "pending" /\ state' = "rejected"
                   /\ redeemable' = redeemable + Cost /\ stock' = stock + 1 /\ refunds' = refunds + 1
                   /\ webhooks' = webhooks + 1 /\ UNCHANGED <<start, debits, autoApprove>>
AdminCancels == /\ state = "approved" /\ state' = "cancelled"
                /\ redeemable' = redeemable + Cost /\ stock' = stock + 1 /\ refunds' = refunds + 1
                /\ webhooks' = webhooks + 1 /\ UNCHANGED <<start, debits, autoApprove>>
\* S53: fulfilled in the app or by Pearson Projects through the API
Fulfilled == /\ state = "approved" /\ state' = "fulfilled" /\ webhooks' = webhooks + 1
             /\ UNCHANGED <<start, redeemable, stock, debits, refunds, autoApprove>>
\* S53: fulfilling again is a no-op; reject/cancel on a final state is refused (CAS)
LateRetry == /\ state \in {"fulfilled", "rejected", "cancelled"} /\ UNCHANGED vars
Done == state = "refused" /\ UNCHANGED vars

Next == MemberRedeems \/ MemberIsRefused \/ ApproverApproves \/ ApproverRejects
        \/ AdminCancels \/ Fulfilled \/ LateRetry \/ Done

BalanceNeverNegative == redeemable >= 0
UnitsConserved == redeemable = start - Cost * debits + Cost * refunds
AtMostOneRefund == refunds <= 1
RefundIffRejectedOrCancelled == (refunds = 1) <=> (state \in {"rejected", "cancelled"})
StockConserved == stock + (IF state \in Held THEN 1 ELSE 0) = InitStock
EveryChangeNotified == webhooks >= (IF state \in Held \cup {"rejected","cancelled"} THEN 1 ELSE 0)
====
