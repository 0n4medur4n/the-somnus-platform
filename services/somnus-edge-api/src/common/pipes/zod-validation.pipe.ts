import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { ZodError, type ZodType } from "zod";

/**
 * Generic Zod validation pipe. Use as:
 *
 *   @UsePipes(new ZodValidationPipe(MySchema))
 *   handler(@Body() input: z.infer<typeof MySchema>) { ... }
 *
 * Or, for the request shape as a whole, declare a Zod object schema
 * and call `.parse()` in the body. Failures throw a SomnusError with
 * code VALIDATION_FAILED and the Zod issue path/message in details.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        const details = Object.fromEntries(
          err.issues.map((issue) => [issue.path.join(".") || "(root)", issue.message]),
        );
        throw new SomnusError(ErrorCode.VALIDATION_FAILED, "The request was invalid.", {
          correlationId: "validation",
          details,
          cause: err,
        });
      }
      if (err instanceof Error) {
        throw new BadRequestException(err.message);
      }
      throw new BadRequestException("Validation failed");
    }
  }
}
