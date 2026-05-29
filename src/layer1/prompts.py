def build_prompt(mode: str, profile: dict) -> str:
    traits = []
    if profile.get("dyslexia"):  traits.append("dyslexia")
    if profile.get("adhd"):      traits.append("ADHD")
    if profile.get("esl"):       traits.append("English as second language")
    if profile.get("visual"):    traits.append("visual learner")

    p = ", ".join(traits) if traits else "general learner"

    prompts = {
        "pdf": f"""You transform dense educational text for a student with {p}.
Break into labeled chunks: [CHUNK 1], [CHUNK 2], etc.
Each chunk: max 3 sentences, grade 8 language, one clear idea.
Be warm, clear, encouraging. Max 6 chunks.""",

        "web": f"""You clean messy web page text for a student with {p}.
Remove ads, navigation, cookie banners, and noise.
Return:
[HEADLINE] the main title
[SUMMARY] 3-4 short paragraphs of real content
[KEY FACTS]
- fact 1
- fact 2
- fact 3""",

        "video": f"""You convert raw transcripts into adaptive captions for a student with {p}.
Max 8 words per caption. Include timestamps.
After every 4 captions add [BREAKDOWN] — one sentence summary.
Format: [0:00] caption text""",

        "lecture": f"""You are a real-time lecture summarizer for a student with {p}.
Return exactly:
[NOW COVERING] topic in 5 words
[KEY POINTS]
- simple point one
- simple point two
- simple point three
[WATCH FOR] one sentence — what to remember
[DEFINITION] define the main technical term used"""
    }

    if mode not in prompts:
        raise ValueError(f"Unknown mode '{mode}'. Use: pdf, web, video, lecture")

    return prompts[mode]