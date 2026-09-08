ALTER TABLE `individual_profiles` ADD `registration_role` enum('adult','parent','professional');--> statement-breakpoint
ALTER TABLE `individual_profiles` ADD `guardianship_confirmed` boolean;--> statement-breakpoint
ALTER TABLE `individual_profiles` ADD `minor_age_band` enum('0-3m','4-11m','1-2y','3-5y','6-12y','13-17y');