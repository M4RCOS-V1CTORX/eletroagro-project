import {useId} from 'react';

export default function ExpenseCategoryField({value,onChange,categories=[]}){
  const id=useId();
  return <label>Categoria da despesa
    <input required minLength="2" maxLength="80" aria-label="Categoria da despesa" list={id} value={value||''} onChange={event=>onChange(event.target.value)} placeholder="Digite ou escolha uma categoria"/>
    <datalist id={id}>{categories.map(name=><option value={name} key={name}/>)}</datalist>
    <small>Use uma categoria existente ou digite uma nova. Ex.: Combustível, Manutenção, Energia.</small>
  </label>;
}
