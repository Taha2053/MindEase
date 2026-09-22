"""Validate article plans without treating omitted optional diagrams as failures."""

import logging
from typing import Any

logger = logging.getLogger(__name__)


class AdaptationPlanError(ValueError):
    """A safe schema diagnostic containing no article text or provider secrets."""


def normalize_adaptation_plan(
    plan: dict[str, Any], source_blocks: list[dict[str, Any]], *, numbered_references: bool = False
) -> dict[str, Any]:
    normalized = {}
    for key in ("learning_goal", "structure_strategy", "default_instruction"):
        value = plan.get(key)
        if not isinstance(value, str) or not value.strip():
            raise AdaptationPlanError(f"{key} must be a non-empty string")
        normalized[key] = value.strip()

    # Overrides and diagrams are optional; JSON null is a normal absence value.
    sections = plan.get("sections")
    if sections is None:
        sections = []
    if not isinstance(sections, list):
        raise AdaptationPlanError("sections must be an array")
    source_order = {
        block["id"]: index
        for index, block in enumerate(source_blocks)
        if isinstance(block.get("id"), str)
    }
    overrides: dict[str, dict[str, str]] = {}
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise AdaptationPlanError(f"sections[{index}] must be an object")
        if numbered_references:
            # References are one-based labels assigned by the server, not the
            # position in the (sparse) overrides array. Never guess a match.
            reference = section.get("block")
            if isinstance(reference, str) and reference.strip().isascii() and reference.strip().isdigit():
                reference = int(reference.strip())
            if type(reference) is int and 1 <= reference <= len(source_blocks):
                block_id = source_blocks[reference - 1].get("id")
            else:
                block_id = None
        else:
            block_id = section.get("id")
        if not isinstance(block_id, str) or block_id.strip() not in source_order:
            # This is only an optional override. Keep the document-wide plan
            # and every source block; do not attach an ungrounded diagram.
            logger.warning(
                "Ignoring article plan override sections[%s]: unknown source reference; "
                "the document-wide instruction still applies to all source blocks",
                index,
            )
            continue
        block_id = block_id.strip()
        instruction = section.get("instruction")
        if not isinstance(instruction, str) or not instruction.strip():
            raise AdaptationPlanError(f"sections[{index}].instruction must be a non-empty string")
        entry = {"id": block_id, "instruction": instruction.strip()}
        visual = section.get("visual_prompt")
        if visual is not None:
            if not isinstance(visual, str):
                raise AdaptationPlanError(f"sections[{index}].visual_prompt must be a string or null")
            if visual.strip():
                entry["visual_prompt"] = visual.strip()
        if block_id in overrides:
            if overrides[block_id] != entry:
                raise AdaptationPlanError(f"sections[{index}] conflicts with an earlier instruction for the same ID")
            continue  # Repeated identical instructions do not change the plan.
        overrides[block_id] = entry

    # The prompt's 24-section target is an output-size hint, not a reason to
    # discard an otherwise valid plan. All overrides still refer to real blocks.
    normalized["sections"] = sorted(overrides.values(), key=lambda entry: source_order[entry["id"]])
    return normalized
