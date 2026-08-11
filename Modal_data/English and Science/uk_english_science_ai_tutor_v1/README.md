# UK English & Science AI Tutor Dataset v1

Structured adaptive-tutoring data for England: Reception, Year 2 and Year 3.

Skill records: 90 total.

## Curriculum interpretation
- Reception English is mapped primarily from EYFS Communication & Language and Literacy.
- Reception 'Science' is mapped from EYFS Understanding the World; Reception does not have a separate statutory National Curriculum Science programme.
- Year 2 English follows the Year 2 programme of study.
- Year 3 English uses the lower-KS2 Years 3-4 programme, expressed here as an AI-tutor Year 3 progression layer. Schools retain flexibility over year-by-year organisation within the key stage.
- Year 2 and Year 3 Science use their DfE year-specific programmes, with Working Scientifically embedded throughout.

## Runtime pattern
Progress -> diagnostic -> prerequisite check -> micro-teach -> guided attempt -> independent attempt -> explanation/application -> mastery -> spaced review.

## Files
Six curriculum JSON files plus skill graph, teaching rules, question-generation rules, mastery rules and a tutor system prompt.

## Important
This dataset paraphrases curriculum intent into machine-readable tutor records. Validate against current DfE statutory material before institutional/school deployment.
