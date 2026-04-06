 Generate a new feature for 'filmbuff project-length' with a value in seconds to set the project final product length at the outset of the creative process.   the user will type in something like 'filmbuff project-length 15'  which will refer to a 15-second long project.   if the user types in 'filmbuff project-length  5400' that would refer to an 1:30 hour long project or 90 minutes.  The different project types are as follows:

filmbuff project-length 

15   this would refer to a 15-second commercial

30  this would refer to a 30-second commercial

60  this would refer to a 60-second commercial

"""120""" or """2 min""" or """2min""" - 2-minute commercial

"""180""" or """3 min""" or """3min""" -   3 minutes  short skit

"""240""" or """4 min""" or """4min""" -  4 minute short skit

"""300""" or """5 min""" or """5min""" -  5 minute narrative

"""300""" or """6 min""" or """6min""" -  6 minute narrative

"""300""" or """7 min""" or """7min""" -  7 minute narrative

"""300""" or """8 min""" or """8min""" -  8 minute narrative

"""300""" or """9 min""" or """9min""" -  9 minute narrative

"""600""" or """10 min""" or """10min""" -  10 minute narrative

"""1800""" or """30 min""" or """30min""" -  30 minute narrative

"""3600""" or """2 min""" or """1hour""" -  1 hour show

"""5400""" or """2 min""" or """2min""" -  1.5 hour show

"""7200""" or """2 min""" or """2min""" -  2 hour show

"""9000""" or """2 min""" or """2min""" -  2.5 hour show

"""10800""" or """2 min""" or """2min""" -  3 hour show

"""12600""" or """2 min""" or """2min""" -  3.5 hour show



The purpose of this feature is to 'confine' the user's eventual prompt for video generation.  When the user set this value, it configures the eventual generated content to be in an acceptable 'format', 'style', and 'narrative' for the allotted time frame.  Certain narratives can 'fit' in the time constraints and others can't.  By limiting the time constraint, it properly sets the boundaries of the video projects.  The project-type times are relatively close to industry standards, although the AI will generate scripts of the exact length to fill the time slot.  So, for example, a 'filmbuff project-length 1800' will not generate a 30 page screenplay, but instead a [22 or whatever is the nominal minutes] minute screenplay due to commercials in the allotted time.  The same applies for all project-type lengths.



The different length of project more commonly have very specific narrative styles, artistic styles, pacing, cinematography, etc. (30 minute sitcom vs a 90 minute Romcom vs a 15 second social media advertisement vs a 3 hour biopic).  When the 'filmbuff project-length' command is run, the same chosen AI that is used for 'filmbuff generate-shot-list' should generate applicable files for the project, with standardized names per every project that can be used to further refine the parameters of the project.  For example, when 'filmbuff generate-shot-list' is run, it will create 'character bibles' and other such content which helps with the process.  'filmbuff project-length' will also generate similar if not all of the base content for the project.