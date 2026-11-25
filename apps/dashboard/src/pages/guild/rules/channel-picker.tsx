import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/ds/field';
import { Pending } from '@/shell/page';
import type { ChannelLite } from '@/lib/schemas';

/*
 * SÉLECTEUR DE SALONS. Les catégories d'abord (une ligne chacune, sur un fond
 * plus reculé), leurs salons en dessous en retrait, puis les salons sans
 * catégorie. Une case s'ajoute ou se retire d'un clic. Les catégories et les
 * salons sont deux sélections distinctes : la page décide laquelle reçoit
 * quoi (une catégorie libre n'est pas une liste de salons libres).
 */

const CATEGORY = 4;

export interface ChannelPickerProps {
  channels: ReadonlyArray<ChannelLite>;
  loading: boolean;
  /** Nom du groupe, lu par un écran. */
  label: string;
  empty: string;
  selectedCategories: ReadonlySet<string>;
  selectedChannels: ReadonlySet<string>;
  onCategory: (id: string) => void;
  onChannel: (id: string) => void;
  /** Faux quand une catégorie ne peut pas être retenue : elle reste un titre de groupe. */
  categoriesSelectable?: boolean;
}

/** L'ensemble avec l'identifiant ajouté, ou retiré s'il s'y trouvait déjà. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

function Row({ channel, checked, onToggle }: { channel: ChannelLite; checked: boolean; onToggle: () => void }) {
  return (
    <Checkbox
      checked={checked}
      onChange={onToggle}
      label={
        <span className="text-sm">
          <span aria-hidden className="text-ink-faint">
            {channel.type === CATEGORY ? '▣ ' : '# '}
          </span>
          {channel.name}
        </span>
      }
    />
  );
}

export function ChannelPicker({
  channels,
  loading,
  label,
  empty,
  selectedCategories,
  selectedChannels,
  onCategory,
  onChannel,
  categoriesSelectable = true,
}: ChannelPickerProps) {
  const { t } = useTranslation();
  if (loading) return <Pending label={t('common.loading')} />;

  const categories = channels.filter((channel) => channel.type === CATEGORY);
  const known = new Set(categories.map((category) => category.id));
  const loose = channels.filter((channel) => channel.type !== CATEGORY && !(channel.category && known.has(channel.category)));

  return (
    <div role="group" aria-label={label} className="notched flex max-h-80 flex-col overflow-y-auto bg-panel">
      {channels.length === 0 ? <p className="p-4 text-sm text-ink-faint">{empty}</p> : null}
      {categories.map((category) => (
        <div key={category.id} className="border-b border-line-soft last:border-b-0">
          <div className={categoriesSelectable ? 'bg-panel-deep' : 'bg-panel-deep px-3 pt-2 pb-1 font-pixel text-xs text-ink-faint'}>
            {categoriesSelectable ? (
              <Row channel={category} checked={selectedCategories.has(category.id)} onToggle={() => onCategory(category.id)} />
            ) : (
              <>▣ {category.name}</>
            )}
          </div>
          {channels
            .filter((channel) => channel.category === category.id)
            .map((channel) => (
              <div key={channel.id} className="pl-7">
                <Row channel={channel} checked={selectedChannels.has(channel.id)} onToggle={() => onChannel(channel.id)} />
              </div>
            ))}
        </div>
      ))}
      {loose.map((channel) => (
        <div key={channel.id} className="border-b border-line-soft last:border-b-0">
          <Row channel={channel} checked={selectedChannels.has(channel.id)} onToggle={() => onChannel(channel.id)} />
        </div>
      ))}
    </div>
  );
}
