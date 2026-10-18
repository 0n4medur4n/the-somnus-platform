-- Down migration for 0006_staff_invitations.
-- Drops the staff invitation table. Reversible: nothing else references it;
-- accepted invitations have already become users and role assignments.
DROP TABLE `staff_invitations`;
