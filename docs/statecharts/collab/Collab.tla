---- MODULE Collab ----
EXTENDS Naturals, FiniteSets
CONSTANTS Members, Goal, Wallet
VARIABLES phase, bal, contrib, redemptions
vars == <<phase, bal, contrib, redemptions>>

RECURSIVE SumOver(_, _)
SumOver(f, S) == IF S = {} THEN 0 ELSE LET x == CHOOSE y \in S : TRUE IN f[x] + SumOver(f, S \ {x})
Raised == SumOver(contrib, Members)
Min(a, b) == IF a < b THEN a ELSE b

Init == /\ phase = "open" /\ bal = [m \in Members |-> Wallet]
        /\ contrib = [m \in Members |-> 0] /\ redemptions = 0

\* S56/S59: contribute redeemable units, capped at what the goal still needs;
\* S57: the contribution that reaches the goal creates the single redemption in the same transaction
Contribute(m, k) == LET take == Min(k, Goal - Raised) IN
   /\ phase = "open" /\ k \in 1..bal[m] /\ Raised < Goal
   /\ bal' = [bal EXCEPT ![m] = @ - take]
   /\ contrib' = [contrib EXCEPT ![m] = @ + take]
   /\ IF Raised + take = Goal
        THEN phase' = "completed" /\ redemptions' = redemptions + 1
        ELSE UNCHANGED <<phase, redemptions>>
SomeoneContributes == \E m \in Members, k \in 1..Wallet : Contribute(m, k)
RefundAll == /\ bal' = [m \in Members |-> bal[m] + contrib[m]] /\ contrib' = [m \in Members |-> 0]
\* S58: archived or deadline passed before the goal -> every contribution goes back
ClosedEarly == phase = "open" /\ phase' = "refunded" /\ RefundAll /\ UNCHANGED redemptions
\* the group redemption is rejected/cancelled -> same refund fan-out
GroupRedemptionRejected == phase = "completed" /\ phase' = "refunded" /\ RefundAll /\ UNCHANGED redemptions
GroupRedemptionDelivered == phase = "completed" /\ phase' = "delivered" /\ UNCHANGED <<bal, contrib, redemptions>>
Done == phase \in {"delivered", "refunded"} /\ UNCHANGED vars

Next == SomeoneContributes \/ ClosedEarly \/ GroupRedemptionRejected \/ GroupRedemptionDelivered \/ Done

NeverOverGoal == Raised <= Goal
UnitsConserved == \A m \in Members : bal[m] + contrib[m] = Wallet
NoNegativeBalance == \A m \in Members : bal[m] >= 0
CompletedMeansGoalMet == phase \in {"completed", "delivered"} => Raised = Goal
OneGroupRedemption == redemptions <= 1 /\ (phase \in {"completed", "delivered"} => redemptions = 1)
RefundedMeansAllBack == phase = "refunded" => \A m \in Members : contrib[m] = 0
====
