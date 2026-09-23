// Executes the realtime session's function calls against the real Homeboard
// backend, mirroring handleTool() in app/page.tsx. Board-side state the real
// client keeps in React (focused widget, recipe choices) is kept here instead.
import { calendarEventsForRange } from '../../app/lib/calendar/local.ts';

export class ToolExecutor {
  constructor(board) {
    this.board = board;
    this.focused = null;
    this.choices = [];
    this.artifact = null;
  }

  async execute(name, argsJson) {
    let args = {};
    try {
      args = JSON.parse(argsJson || '{}');
    } catch {
      return { error: 'Invalid request' };
    }
    try {
      return await this.#run(name, args);
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : 'That request did not work.',
      };
    }
  }

  async #widgets() {
    const board = await this.board.list();
    return board.widgets.filter((w) => !w.archived);
  }

  async #selected(id) {
    const widgets = await this.#widgets();
    if (typeof id === 'string' && id) {
      const matches = widgets.filter(
        (w) => w.id === id || w.title.toLowerCase() === id.toLowerCase(),
      );
      if (matches.length === 1) return matches[0];
      throw Error('That widget is not on the board.');
    }
    const focused = widgets.find((w) => w.id === this.focused);
    if (focused) return focused;
    throw Error(
      'Ask which widget the user means. No widget is currently selected.',
    );
  }

  async #run(name, args) {
    switch (name) {
      case 'list_widgets':
        return {
          widgets: (await this.#widgets()).map((w) => ({
            id: w.id,
            title: w.title,
            kind: w.definition.kind,
            pinned: w.pinned,
          })),
          focused: this.focused,
          visual: this.artifact
            ? { id: this.artifact.id, title: this.artifact.title }
            : null,
        };

      case 'show_visual': {
        try {
          const artifact = await this.board.showVisual(
            typeof args.query === 'string' ? args.query : '',
          );
          this.artifact = artifact;
          this.focused = null;
          this.choices = [];
          return {
            shown: true,
            title: artifact.title,
            id: artifact.id,
            summary: artifact.definition.summary.slice(0, 300),
          };
        } catch (error) {
          return {
            shown: false,
            fallback: true,
            reason:
              error instanceof Error
                ? error.message
                : 'The visual could not be made.',
          };
        }
      }

      case 'control_visual': {
        const current = this.artifact;
        if (!current) throw Error('No visual is open. Ask what to show.');
        if (args.action === 'keep') {
          const { widget } = await this.board.artifactAct(current.id, 'keep');
          this.artifact = null;
          this.focused = widget.id;
          return { kept: true, title: widget.title };
        }
        if (args.action === 'refine') {
          const { artifact } = await this.board.artifactAct(
            current.id,
            'refine',
            {
              instruction:
                typeof args.instruction === 'string' ? args.instruction : '',
            },
          );
          this.artifact = artifact;
          return { updated: artifact.title };
        }
        if (args.action === 'close') {
          this.artifact = null;
          return { closed: true };
        }
        throw Error('That action is not supported.');
      }

      case 'create_widget': {
        const result = await this.board.resolve(
          typeof args.query === 'string' ? args.query : '',
        );
        this.focused = result.widget.id;
        return {
          created: true,
          title: result.widget.title,
          id: result.widget.id,
        };
      }

      case 'control_widget': {
        if (args.action === 'board') {
          this.focused = null;
          return { displayed: 'board' };
        }
        if (!args.widget && this.artifact) {
          const current = this.artifact;
          if (args.action === 'keep') {
            const { widget } = await this.board.artifactAct(
              current.id,
              'keep',
            );
            this.artifact = null;
            this.focused = widget.id;
            return { updated: widget.title };
          }
          if (args.action === 'refine') {
            const { artifact } = await this.board.artifactAct(
              current.id,
              'refine',
              {
                instruction:
                  typeof args.instruction === 'string' ? args.instruction : '',
              },
            );
            this.artifact = artifact;
            return { updated: artifact.title };
          }
          if (args.action === 'remove') {
            await this.board.artifactAct(current.id, 'dismiss');
            this.artifact = null;
            return { updated: current.title };
          }
        }
        const widget = await this.#selected(args.widget);
        if (args.action === 'focus') {
          this.focused = widget.id;
          return { focused: widget.title };
        }
        const result = await this.board.act(widget.id, String(args.action), {
          size: args.size,
          instruction: args.instruction,
        });
        if (!result) throw Error('The widget could not be updated.');
        return { updated: result.title };
      }

      case 'show_dashboard': {
        if (args.view === 'home') {
          this.focused = null;
          return { displayed: 'board' };
        }
        const target = (await this.#widgets()).find((w) =>
          args.view === 'recipes'
            ? w.definition.kind === 'library'
            : args.view === 'schedule'
              ? w.title === 'Everyone’s day'
              : args.view === 'weather'
                ? w.definition.kind === 'weather'
                : w.title === 'Monthly spending',
        );
        if (!target) throw Error('That widget is not on the board.');
        this.focused = target.id;
        return {
          displayed: target.title,
          example: args.view === 'spending',
        };
      }

      case 'find_recipes':
      case 'find_saved_recipe': {
        const query = typeof args.query === 'string' ? args.query : '';
        this.choices =
          name === 'find_recipes'
            ? await this.board.findRecipes(query)
            : await this.board.savedRecipes(query);
        return {
          recipes: this.choices.map((r, i) => ({
            option: i + 1,
            title: r.title,
            source: r.sourceName,
          })),
        };
      }

      case 'choose_recipe': {
        const recipe = this.choices[Number(args.option) - 1];
        if (!recipe) throw Error('That recipe option is not available.');
        const widget = await this.board.openRecipe(recipe);
        if (!widget) throw Error('The recipe could not be opened.');
        this.focused = widget.id;
        return { selected: widget.title };
      }

      case 'move_recipe_step': {
        const widget = await this.#selected();
        const result = await this.board.act(widget.id, 'step', {
          direction: args.direction,
        });
        if (!result) throw Error('The cooking step could not be changed.');
        return { moved: true, step: result.state.stepId };
      }

      case 'save_current_recipe': {
        const widget = await this.#selected();
        const recipe = widget.snapshot.data.recipe;
        if (!recipe) throw Error('Choose a recipe first.');
        await this.board.saveRecipe({
          ...recipe,
          familyNote:
            typeof args.note === 'string' ? args.note : recipe.familyNote,
        });
        await this.board.act(widget.id, 'keep');
        const library = (await this.#widgets()).find(
          (w) => w.definition.kind === 'library',
        );
        if (library) await this.board.act(library.id, 'refresh');
        return { saved: true, title: recipe.title };
      }

      case 'add_recipe_to_shopping': {
        const widget = await this.#selected();
        const list = (await this.#widgets()).find(
          (w) => w.definition.kind === 'shopping',
        );
        if (!list)
          throw Error('Restore your shopping widget before adding ingredients.');
        const ingredients = widget.snapshot.data.recipe?.ingredients ?? [];
        const result = await this.board.act(list.id, 'add_items', {
          items: ingredients,
          source: 'recipe',
        });
        if (!result) throw Error('The shopping list was not changed.');
        return { added: true };
      }

      case 'add_shopping_items': {
        const list = (await this.#widgets()).find(
          (w) => w.definition.kind === 'shopping',
        );
        if (!list) throw Error('Restore your shopping widget first.');
        const result = await this.board.act(list.id, 'add_items', {
          items: args.items,
        });
        if (!result) throw Error('The shopping list was not changed.');
        return { added: true };
      }

      case 'add_chore': {
        const list = (await this.#widgets()).find(
          (w) => w.definition.kind === 'chores' && !w.archived,
        );
        if (!list) throw Error('Restore your chores widget first.');
        const result = await this.board.act(list.id, 'add_chores', {
          items: [{ text: args.text, member: args.member }],
        });
        if (!result) throw Error('The chores list was not changed.');
        return { added: true };
      }

      case 'get_calendar_events': {
        const calendar = (await this.#widgets()).find(
          (w) => w.definition.kind === 'calendar',
        );
        if (!calendar?.snapshot.data.calendarConnected)
          return {
            connected: false,
            events: [],
            message: 'iCloud Calendar is not connected.',
          };
        const range = ['today', 'tomorrow', 'upcoming'].includes(args.range)
          ? args.range
          : 'upcoming';
        this.focused = calendar.id;
        return {
          connected: true,
          updatedAt: calendar.snapshot.fetchedAt,
          ...calendarEventsForRange(
            calendar.snapshot.data.calendarEvents ?? [],
            range,
          ),
        };
      }

      case 'get_weather': {
        const widget = (await this.#widgets()).find(
          (w) => w.definition.kind === 'weather',
        );
        const weather = widget?.snapshot.data.weather;
        if (!widget || !weather)
          return {
            available: false,
            message: 'The weather forecast is not on the board yet.',
          };
        this.focused = widget.id;
        return {
          available: true,
          place: weather.place,
          updatedAt: widget.snapshot.fetchedAt,
          now: {
            temperature: Math.round(weather.temperature),
            feelsLike: Math.round(weather.feelsLike),
            condition: weather.condition,
            windKmh: Math.round(weather.windKmh),
          },
          days: weather.days.map((day) => ({
            date: day.date,
            condition: day.condition,
            high: Math.round(day.high),
            low: Math.round(day.low),
            rainChance: day.rainChance,
          })),
        };
      }

      default:
        throw Error('That action is not supported.');
    }
  }
}
