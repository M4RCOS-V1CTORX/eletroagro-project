import {useId} from 'react';

export default function ExpenseCategoryField({value,onChange,categories=[],label='Categoria da despesa'}){
  const id=useId();
  return <label>{label}
    <input required minLength="2" maxLength="80" aria-label={label} list={id} value={value||''} onChange={event=>onChange(event.target.value)} placeholder="Digite ou escolha uma categoria"/>
    <datalist id={id}>{categories.map(name=><option value={name} key={name}/>)}</datalist>
    <small>Use uma categoria existente ou digite uma nova. Ex.: Combustível, Manutenção, Energia.</small>
  </label>;
}
