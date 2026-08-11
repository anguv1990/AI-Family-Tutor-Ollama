-- A picture of the question, stored as JSON.
--
-- The first observed sitting with a four-year-old showed them ignoring the
-- spoken prompt and tapping anyway, which means they were guessing: they could
-- not read the question and were not listening to it. Text and audio were two
-- ways of saying the same thing, and the child used neither.
--
-- The prompt is unchanged — it is still what is read aloud and what an adult
-- reviews. This is a third way of asking, which needs no reading and no sound.
--
-- Nullable: Year 3 children read the prompt, and an adult may add a reviewed
-- template without a picture.

ALTER TABLE content_templates ADD COLUMN visual TEXT;
