---- MODULE Quest ----
EXTENDS Naturals
CONSTANTS Cap, Reward
VARIABLES quest, sub, needsApproval, approvedCount, paid, submittedWhileClosed
vars == <<quest, sub, needsApproval, approvedCount, paid, submittedWhileClosed>>

Init == /\ quest = "draft" /\ sub = "none" /\ needsApproval \in BOOLEAN
        /\ approvedCount = 0 /\ paid = 0 /\ submittedWhileClosed = FALSE

AdminPublishes == quest = "draft" /\ quest' = "open" /\ UNCHANGED <<sub, needsApproval, approvedCount, paid, submittedWhileClosed>>
\* S64/S66: submit (self or nomination); without required approval it is approved on submit
MemberSubmits == /\ quest = "open" /\ sub \in {"none", "rejected", "approved"} /\ approvedCount < Cap
   /\ submittedWhileClosed' = (quest # "open")
   /\ UNCHANGED <<quest, needsApproval>>
   /\ (IF needsApproval
        THEN sub' = "pending" /\ UNCHANGED <<approvedCount, paid>>
        ELSE sub' = "approved" /\ approvedCount' = approvedCount + 1 /\ paid' = paid + Reward)
\* S65: pending submissions can still be reviewed after the quest closes
ApproverApproves == /\ sub = "pending" /\ sub' = "approved"
   /\ approvedCount' = approvedCount + 1 /\ paid' = paid + Reward
   /\ UNCHANGED <<quest, needsApproval, submittedWhileClosed>>
ApproverRejects == sub = "pending" /\ sub' = "rejected" /\ UNCHANGED <<quest, needsApproval, approvedCount, paid, submittedWhileClosed>>
QuestCloses == quest = "open" /\ quest' = "closed" /\ UNCHANGED <<sub, needsApproval, approvedCount, paid, submittedWhileClosed>>
Done == quest = "closed" /\ sub # "pending" /\ UNCHANGED vars

Next == AdminPublishes \/ MemberSubmits \/ ApproverApproves \/ ApproverRejects \/ QuestCloses \/ Done

PaidOnlyForApprovals == paid = Reward * approvedCount
CapRespected == approvedCount <= Cap
NoSubmissionOutsideWindow == ~submittedWhileClosed
NothingPendingWithoutApprovalStep == sub = "pending" => needsApproval
====
