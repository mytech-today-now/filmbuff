Refactor FilmBuff AI-powered CLI commands, for example `filmbuff generate-shot-list`, so they use a selectable AI provider instead of depending on Augment Code AI through the VS Code chatbot. I want FilmBuff to use a shared AI provider abstraction so all supported AI-powered commands can resolve the currently active provider/profile automatically.

I want initial built-in configuration support for Anthropic, OpenAI, and Google AI. I also want users to be able to add and configure their own custom AI providers, including community, open-source, self-hosted, or adapter-based providers such as `https://github.com/whitead/paLM-api`, `https://github.com/ollama/ollama`, `https://github.com/mudler/LocalAI`, `https://github.com/vllm-project/vllm`, and `https://github.com/oobabooga/text-generation-webui`.

I want the AI source to be configurable from the command line, with CLI commands to create, edit, list, validate, delete, and switch AI provider configurations and profiles. I want to be able to save multiple named configurations for each provider, for example personal, work, client, or testing, and switch between them with the CLI.

I want new and refactored CLI commands to support `-h` / `--help` and `-v` / `--version`, with clear and consistent FilmBuff-style help output. I also want provider validation, user-friendly error messages, and secure handling of API keys and related secrets so credentials are not exposed in normal output.

I want to be able to run `filmbuff configure` and have it open a GUI that allows me to select from the available AI providers, enter the necessary settings, validate them, save multiple profiles, and set the active provider/profile.

I want to be able to run `filmbuff gui` and have it open a GUI that allows me to view and manage linked modules, search for modules, and configure my AI provider settings in the same place. I want to be able to switch between AI providers in the GUI and have the GUI always reflect the current active provider/profile.

I want the architecture to make it easy to add future providers with minimal changes, and I want the implementation to include testing and documentation for provider selection, profile persistence, command routing, validation behavior, GUI flows, and custom-provider extensibility.
