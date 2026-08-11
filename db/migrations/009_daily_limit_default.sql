-- The daily session cap defaulted to one, which made the app unusable in
-- practice: the first observed sitting with a real child ended with the tutor
-- telling them to come back tomorrow, so nobody could see what happens after a
-- wrong answer, and the child was refused a second go they wanted.
--
-- A session is already bounded at eight answered questions or ten minutes, so
-- the wellbeing control the cap exists for is not weakened much by allowing
-- three of them. An adult can still set any limit per child.
--
-- Only children still on the old default are moved. A limit an adult chose
-- deliberately — including one — is left exactly as they set it.

UPDATE children SET daily_session_limit = 3 WHERE daily_session_limit = 1;
