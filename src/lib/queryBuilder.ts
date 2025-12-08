/**
 * Fluent SQL query builder for parameterized PostgreSQL queries
 * Handles automatic parameter numbering and condition building
 */
export class QueryBuilder {
  private conditions: string[] = [];
  private params: unknown[] = [];
  private paramCount = 1;

  /**
   * Add a simple equality condition
   */
  equals(column: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.conditions.push(`${column} = $${this.paramCount}`);
    this.params.push(value);
    this.paramCount++;
    return this;
  }

  /**
   * Add a ILIKE condition for case-insensitive partial matching
   */
  ilike(column: string, value: string | undefined, wrap = true): this {
    if (!value) return this;
    this.conditions.push(`${column} ILIKE $${this.paramCount}`);
    this.params.push(wrap ? `%${value}%` : value);
    this.paramCount++;
    return this;
  }

  /**
   * Add a >= condition
   */
  gte(column: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.conditions.push(`${column} >= $${this.paramCount}`);
    this.params.push(value);
    this.paramCount++;
    return this;
  }

  /**
   * Add a <= condition
   */
  lte(column: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.conditions.push(`${column} <= $${this.paramCount}`);
    this.params.push(value);
    this.paramCount++;
    return this;
  }

  /**
   * Add a boolean condition
   */
  boolean(column: string, value: boolean | undefined): this {
    if (typeof value !== "boolean") return this;
    this.conditions.push(`${column} = $${this.paramCount}`);
    this.params.push(value);
    this.paramCount++;
    return this;
  }

  /**
   * Add a NULL/NOT NULL check
   */
  isNull(column: string, shouldBeNull: boolean): this {
    this.conditions.push(shouldBeNull ? `${column} IS NULL` : `${column} IS NOT NULL`);
    return this;
  }

  /**
   * Add conditional NULL check based on a boolean filter
   */
  hasValue(column: string, hasValue: boolean | undefined): this {
    if (typeof hasValue !== "boolean") return this;
    return this.isNull(column, !hasValue);
  }

  /**
   * Add a custom condition with parameters
   * Use ? as placeholder which will be replaced with $N
   */
  custom(condition: string, ...values: unknown[]): this {
    if (values.length === 0) {
      this.conditions.push(condition);
      return this;
    }

    let processedCondition = condition;
    for (const value of values) {
      processedCondition = processedCondition.replace("?", `$${this.paramCount}`);
      this.params.push(value);
      this.paramCount++;
    }
    this.conditions.push(processedCondition);
    return this;
  }

  /**
   * Add a path matching condition (exact match OR starts with path/)
   */
  pathMatch(column: string, path: string | undefined): this {
    if (!path) return this;
    this.conditions.push(`(${column} = $${this.paramCount} OR ${column} LIKE $${this.paramCount + 1})`);
    this.params.push(path, `${path}/%`);
    this.paramCount += 2;
    return this;
  }

  /**
   * Add LIMIT and OFFSET parameters
   * Returns the parameter indices for use in the query
   */
  pagination(limit: number, offset: number): { limitParam: string; offsetParam: string } {
    const limitParam = `$${this.paramCount}`;
    this.params.push(limit);
    this.paramCount++;

    const offsetParam = `$${this.paramCount}`;
    this.params.push(offset);
    this.paramCount++;

    return { limitParam, offsetParam };
  }

  /**
   * Get the WHERE clause (empty string if no conditions)
   */
  getWhereClause(): string {
    if (this.conditions.length === 0) return "";
    return `WHERE ${this.conditions.join(" AND ")}`;
  }

  /**
   * Get all parameters
   */
  getParams(): unknown[] {
    return this.params;
  }

  /**
   * Get current parameter count (for adding more params after build)
   */
  getParamCount(): number {
    return this.paramCount;
  }

  /**
   * Add a raw parameter and return its placeholder
   */
  addParam(value: unknown): string {
    this.params.push(value);
    return `$${this.paramCount++}`;
  }
}
