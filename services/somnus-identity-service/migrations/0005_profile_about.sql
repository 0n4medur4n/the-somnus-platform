ALTER TABLE `individual_profiles` ADD `gender` enum('male','female','prefer_not_to_say');--> statement-breakpoint
ALTER TABLE `individual_profiles` ADD `country` varchar(2);--> statement-breakpoint
ALTER TABLE `individual_profiles` ADD `city` varchar(120);