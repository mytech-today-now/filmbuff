The command 'filmbuff start' will generate the following documents (.md, .json, .fountain, & .pdf) for a new project. The user will be prompted to input information as needed.  The user will be able to override any of the generated information.  The user will be able to override  the output directory.  The user will be able to specify the file names and types.  The user will be able to specify the level of detail for each document.  The user will be able to specify the tone and style of the documents.  The user will be able to specify the genre of the film.  The user will be able to specify the target audience for the film.  The user will be able to specify the budget for the film.  The user will be able to specify the desired outcome for the film.  The user will be able to specify any other relevant information.  The user will be able to specify the name of the film.  The user will be able to specify the title of the film.  The user will be able to specify the logline for the film.  The user will be able to specify the synopsis for the film.  The user will be able to specify the treatment for the film.  The user will be able to specify the beat sheet for the film.  The user will be able to specify the screenplay for the film.  The user will be able to specify the shooting script for the film.  The user will be able to specify the script breakdown for the film.  The user will be able to specify the shot list for the film.  The user will be able to specify the storyboards for the film.  The user will be able to specify the final screenplay for the film.  The user will be able to specify the final shooting script for the film.  The user will be able to specify the final script breakdown for the film.  The user will be able to specify the final shot list for the film.  The user will be able to specify the final storyboards for the film.  The user will be able to specify the final screenplay in .pdf format for the film.  The user will be able to specify the final shooting script in .pdf format for the film.  The user will be able to specify the final script breakdown in .pdf format for the film.  The user will be able to specify the final shot list in .pdf format for the film.  The user will be able to specify the final storyboards in .pdf format for the film.  The user will be able to specify the final screenplay in .md format for the film.  The user will be able to specify the final shooting script in .md format for the film.  The user will be able to specify the final script breakdown in .md format for the film.  The user will be able to specify the final shot list in .md format for the film.  The user will be able to specify the final storyboards in .md format for the film.  The user will be able to specify the final screenplay in .json format for the film.  The user will be able to specify the final shooting script in .json format for the film.  The user will be able to specify the final script breakdown in .json format for the film.  The user will be able to specify the final shot list in .json format for the film.  The user will be able to specify the final storyboards in .json format for the film.  The user will be able to specify the final screenplay in .fountain format for the film.  The user will be able to specify the final shooting script in .fountain format for the film.  The user will be able to specify the final script breakdown in .fountain format for the film.  The user will be able to specify the final shot list in .fountain format for the film.  The user will be able to specify the final storyboards in .fountain format for the film.  The user will be able to specify the final screenplay in .pdf, .md, .json, or .fountain format for the film.  The user will be able to specify the final shooting script in .pdf, .md, .json, or .fountain format for the film.  The user will be able to specify the final script breakdown in .pdf, .md, .json, or .fountain format for the film.  The user will be able to specify the final shot list in .pdf, .md, .json, or .fountain format for the film.  The user will be able to specify the final storyboards in .pdf, .md, .json, or .fountain format for the film.  The user will be able to specify the final screenplay in any format for the film.  The user will be able to specify the final shooting script in any format for the film.  The user will be able to specify the final script breakdown in any format for the film.  The user will be able to specify the final shot list in any format for the film.  The user will be able to specify the final storyboards in any format for the film.  The user will be able to specify the final screenplay in any format for the film.  The user will be able to specify the final shooting script in any format for the film.  The user will be able to specify the final script breakdown in any format for the film.  The user will be able to specify the final shot list in any format for the film.  The user will be able to specify the final storyboards in any format for the film.  The user will be able to specify the final screenplay in any format for the film.  The user will be able to specify the final shooting script in any format for the film.  The user will be able to specify the final script breakdown in any format for the film.  The user will be able to specify the final shot list in any format for the film.  The user will be able to specify the final storyboards in any format for the film.  The user will be able to specify the final screenplay in any format for the film.  The user will be able to specify the final shooting script in any format for the film.  The user will be able to specify the final script breakdown in any format for the film.  The user will be able to specify the final shot list in any format for the film.  The user will be able to specify the final story

logline.md: A concise one-sentence summary capturing the core premise, conflict, and hook of the story, often the first written articulation of the initial idea.

synopsis.md: A short summary (typically 1-2 pages) outlining the plot, characters, and key events to pitch or refine the concept.

treatment.md: A narrative prose document (5-20 pages) expanding on the story, tone, characters, and arc without dialogue, used to develop and sell the idea.

beat-sheet.json: A structured breakdown of the story into acts, scenes, and key beats, serving as a roadmap for scripting.

screenplay.fountain: The full scripted document including dialogue, action descriptions, and scene headings, going through multiple drafts.

shooting-script.fountain: A production-ready version of the screenplay with added technical notes, scene numbers, and revisions for filming.

script-breakdown.md: An analysis of the screenplay identifying all production elements like locations, props, cast, costumes, and special effects.

storyboards.pdf: A multi-page storyboard document containing an ordered sequence of visual frames or illustrations used to plan the film's visual storytelling.

shot-list.md or shot-list.json: A detailed inventory of every planned shot, specifying camera angles, movements, lens types, and order for efficient shooting.

the command 'filmbuff start' will use the following workflow:

1. Generate logline.md
2. Generate synopsis.md
3. Generate treatment.md
4. Generate beat-sheet.json
5. Generate screenplay.fountain
6. Generate shooting-script.fountain
7. Generate script-breakdown.md
8. Generate storyboards.pdf
9. generate-shot-list
10. Generate final screenplay.md

The command 'filmbuff continue' will continue from the last generated document and follow the same workflow as 'filmbuff start'.

The command 'filmbuff complete' will mark the current task as complete and move to the next task in the workflow.

The command 'filmbuff retry' will retry the last failed task.

the filmbuff workflow is designed to be used with the following command: filmbuff continue, and will use the output of the previous command as input for the next command.

Do not make up any files or information. If you are unsure, ask the user for clarification.  The file names and types must match exactly as specified.  Do not include any extra files that are not specified.  Do not include any extra information that is not specified.  Do not include any extra files that are not specified.  Do not include any extra information that is not specified.  Do not include any extra files that are not specified.  Do not include any extra information that is not specified.  Do not include any extra files that are not specified.

The generated files will be used to create a screenplay for a film.  The screenplay will be used to create a shooting script.  The shooting script will be used to create a script breakdown.  The script breakdown will be used to create a shot-list.

The shot-list will be used to either create a new storyboard or continue to the next step in the workflow or used to generate AI video of each shot.


