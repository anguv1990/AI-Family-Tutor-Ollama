# UK Maths AI Tutor Dataset v1

## Scope
England: Reception mathematics, Year 2 mathematics, Year 3 mathematics.

## Purpose
This is a curriculum-aligned knowledge and control dataset for an adaptive AI tutor. It is designed for RAG, application logic, prompt orchestration or later conversion into database records. It is not a model fine-tuning corpus by itself.

## Files
- `curriculum/reception_math.json` — Reception maths skill records
- `curriculum/year2_math.json` — Year 2 maths skill records
- `curriculum/year3_math.json` — Year 3 maths skill records
- `knowledge/skill_graph.json` — prerequisite relationships
- `knowledge/misconceptions.json` — common misconception hooks
- `teaching/teaching_strategies.json` — tutoring behaviour
- `teaching/question_generation.json` — dynamic question-generation rules
- `assessment/mastery_rules.json` — diagnostics, mastery and spaced review
- `ai/tutor_system_prompt.md` — starter system prompt

## Important design choice
The dataset stores skills, bounds and generation rules rather than thousands of fixed questions. This allows the AI to generate varied practice while remaining inside defined curriculum boundaries.

## Recommended runtime flow
1. Load child stage and progress.
2. Select due review skill or next unmastered skill.
3. Check prerequisites in `skill_graph.json`.
4. Generate a question using the skill's `question_generation`.
5. Evaluate the response.
6. Tag misconception where relevant.
7. Follow remediation rules.
8. Update mastery state.
9. Schedule spaced review.

## Curriculum grounding
The structure is paraphrased from Department for Education curriculum/guidance for England. Do not treat this dataset as a verbatim legal reproduction. Validate against the current DfE material when publishing or using in a school setting.

## Suggested next version
- Add Year 1 as a complete bridge between Reception and Year 2.
- Add hundreds of misconception patterns and worked examples.
- Add visual-manipulative descriptors for image generation.
- Add parent dashboard/progress schema.
- Add automated test cases to ensure generated questions stay within curriculum constraints.
