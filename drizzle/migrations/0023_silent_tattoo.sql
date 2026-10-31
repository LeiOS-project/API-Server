-- Custom SQL migration file, put your code below! --

INSERT INTO `publisher_members` (`publisher_id`, `user_id`, `role`)
SELECT p.`id`, p.`owner_user_id`, 'ADMIN'
FROM `publishers` p
WHERE NOT EXISTS (
    SELECT 1 FROM `publisher_members` pm
    WHERE pm.`publisher_id` = p.`id` AND pm.`user_id` = p.`owner_user_id`
);
