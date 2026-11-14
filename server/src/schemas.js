// Building blocks shared by the request schemas. The messages are the exact
// wording the RealWorld spec expects ("can't be blank", "is invalid").
import { z } from 'zod';

export const BLANK = "can't be blank";

// A string that must be present and not empty after trimming.
export const requiredText = (max = 255) =>
  z.string({ error: BLANK }).trim().min(1, BLANK).max(max, `is too long (maximum is ${max} characters)`);

// Optional profile text: null and "" both mean "no value" and are stored as NULL.
export const nullableText = (max = 500) =>
  z
    .union([z.string().max(max, `is too long (maximum is ${max} characters)`), z.null()])
    .transform((value) => value?.trim() || null);
