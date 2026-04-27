import { describe, it, expect, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { SkillLoader } from "../src/skills/loader.js";

describe("SkillLoader", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rookie-skills-"));
  });

  async function writeSkill(name: string, content: string): Promise<string> {
    const dir = path.join(tmp, name);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "SKILL.md");
    await fs.writeFile(file, content, "utf-8");
    return file;
  }

  it("parses frontmatter + body", async () => {
    const file = await writeSkill(
      "demo",
      "---\nname: demo\ndescription: Demo skill\nallowed-tools: file_read shell_execute\ncontext: inline\n---\nHello $ARGUMENTS"
    );
    const loader = new SkillLoader();
    const skill = await loader.parseFile(file);
    expect(skill.frontmatter.name).toBe("demo");
    expect(skill.frontmatter.description).toBe("Demo skill");
    expect(skill.frontmatter["allowed-tools"]).toBe("file_read shell_execute");
    expect(skill.frontmatter.context).toBe("inline");
    expect(skill.prompt).toContain("Hello $ARGUMENTS");
  });

  it("throws on missing frontmatter", async () => {
    const file = await writeSkill("bad", "no frontmatter here");
    const loader = new SkillLoader();
    await expect(loader.parseFile(file)).rejects.toThrow(/frontmatter/);
  });

  it("throws on missing required fields", async () => {
    const file = await writeSkill("bad2", "---\ndescription: no name\n---\nbody");
    const loader = new SkillLoader();
    await expect(loader.parseFile(file)).rejects.toThrow(/name/);
  });

  it("loads a directory tree", async () => {
    await writeSkill("one", "---\nname: one\ndescription: one\n---\nbody1");
    await writeSkill("two", "---\nname: two\ndescription: two\n---\nbody2");
    const loader = new SkillLoader();
    const skills = await loader.loadDirectory(tmp);
    const names = skills.map((s) => s.frontmatter.name).sort();
    expect(names).toEqual(["one", "two"]);
  });

  it("preprocesses !`cmd` to shell output", async () => {
    const file = await writeSkill(
      "shell",
      "---\nname: shell\ndescription: d\n---\nHello !`echo world`!"
    );
    const loader = new SkillLoader();
    const md = await loader.parseFile(file);
    const resolved = await loader.resolve(md, tmp);
    expect(resolved.resolvedPrompt).toContain("world");
  });

  it("converts SkillMd → Skill with default triggers", async () => {
    const file = await writeSkill(
      "conv",
      "---\nname: conv\ndescription: A conversion test\nallowed-tools: file_read\n---\nDo stuff"
    );
    const loader = new SkillLoader();
    const md = await loader.parseFile(file);
    const skill = loader.toSkill(md);
    expect(skill.name).toBe("conv");
    expect(skill.tools).toEqual(["file_read"]);
    expect(skill.triggers.some((t) => t.type === "command" && t.value === "/conv")).toBe(true);
  });
});
